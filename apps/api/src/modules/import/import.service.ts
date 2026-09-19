import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import {
  Account,
  AccountType,
  Category,
  CategoryType,
  Currency,
  Group,
  GroupMember,
  MemberRole,
  RecurrenceUnit,
  RecurringRule,
  Transaction,
  TransactionType,
} from '@ft/api-database';
import { AccountsService } from '../ledger/accounts/accounts.service';
import { ExchangeRatesService } from '../ledger/exchange-rates/exchange-rates.service';
import { materializeOccurrences } from '../recurring/occurrence-materializer';
import type { ParsedBackup } from './one-money-parser';

// Where the money each account already held on the day its history starts is recorded: balances
// here are the sum of a group's transactions, so an opening balance has to be one.
const OPENING_BALANCE_NOTE = 'Opening balance';
// Far enough before the first transaction to sort above it without colliding.
const OPENING_BALANCE_OFFSET_MS = 60_000;
// Transactions are inserted in batches; big enough to be quick, small enough to stay well inside
// Postgres' limit on parameters per statement.
const INSERT_CHUNK = 500;

export interface ImportSummary {
  groupId: string;
  groupName: string;
  accounts: number;
  categories: number;
  transactions: number;
  // Transactions dated in the future, which show up as planned: one-off ones, and the next
  // occurrence of each recurring rule.
  plannedTransactions: number;
  // 1Money's repeating entries, which carry on here as recurring rules.
  recurringRules: number;
  openingBalances: number;
  // Every account as it stands after the import, to compare against the old app. Balances
  // exclude planned transactions, which is what the other app's own export shows.
  balances: { name: string; currency: string; balance: string }[];
}

@Injectable()
export class ImportService {
  constructor(
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(Currency) private readonly currencies: Repository<Currency>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(RecurringRule) private readonly rules: Repository<RecurringRule>,
    private readonly accountsService: AccountsService,
    private readonly rates: ExchangeRatesService,
  ) {}

  /**
   * Writes a parsed backup as a brand-new group owned by the caller. `timezone` is the IANA zone
   * the repeating entries follow: 1Money schedules them at local midnight, and "the 7th of every
   * month" only stays on the 7th when the months are counted in the zone it was meant in.
   */
  @Transactional()
  async importBackup(userId: string, groupName: string, backup: ParsedBackup, timezone = 'UTC'): Promise<ImportSummary> {
    if (backup.unknownCurrencies.length > 0) {
      const detail = backup.unknownCurrencies
        .map(({ currencyId, accounts }) => `${currencyId} (${accounts.join(', ')})`)
        .join('; ');
      throw new UnprocessableEntityException(
        `Unknown 1Money currency ids: ${detail}. Pass them as currencies=<id>:<code>,… to import this file.`,
      );
    }

    const currencyIds = await this.currencyIdsByCode(backup);
    const group = await this.groups.save(this.groups.create({ name: groupName, ownerId: userId }));
    await this.members.save(this.members.create({ groupId: group.id, userId, role: MemberRole.OWNER }));

    const accountIds = new Map<number, string>();
    for (const parsed of backup.accounts) {
      const account = await this.accounts.save(
        this.accounts.create({
          groupId: group.id,
          name: parsed.name,
          description: parsed.description,
          // The parser speaks the shared string union; the entity wants its own enum, whose
          // members are those same strings.
          type: parsed.type as AccountType,
          icon: parsed.icon,
          currencyId: currencyIds.get(parsed.currencyCode),
          isIncludedInBalance: parsed.isIncludedInBalance,
          archived: parsed.archived,
          archivedAt: parsed.archived ? new Date() : null,
          sortOrder: parsed.sortOrder,
          color: parsed.color,
          createdBy: userId,
        }),
      );
      accountIds.set(parsed.sourceId, account.id);
    }

    // 1Money allows two categories of the same name and type (its own default plus one the user
    // added); here they become one, and both source ids point at it. Only among siblings, though:
    // a subcategory never merges with a top-level category, or with one under another parent.
    // Parents arrive first, so by the time a subcategory comes up its parent already has an id.
    const categoryIds = new Map<number, string>();
    const bySiblingName = new Map<string, string>();
    for (const parsed of backup.categories) {
      const parentId = parsed.parentSourceId === null ? null : (categoryIds.get(parsed.parentSourceId) ?? null);
      const key = `${parsed.type}:${parentId ?? ''}:${parsed.name.toLocaleLowerCase()}`;
      let id = bySiblingName.get(key);
      if (!id) {
        const category = await this.categories.save(
          this.categories.create({
            groupId: group.id,
            parentId,
            name: parsed.name,
            type: parsed.type as CategoryType,
            icon: parsed.icon,
            color: parsed.color,
            sortOrder: parsed.sortOrder,
            archived: parsed.archived,
            archivedAt: parsed.archived ? new Date() : null,
            createdBy: userId,
          }),
        );
        id = category.id;
        bySiblingName.set(key, id);
      }
      categoryIds.set(parsed.sourceId, id);
    }

    const currencyOf = new Map(backup.accounts.map((account) => [account.sourceId, currencyIds.get(account.currencyCode)]));
    const rows: Partial<Transaction>[] = [];

    const firstDate = backup.transactions[0]?.date ?? new Date();
    let openingBalances = 0;
    for (const parsed of backup.accounts) {
      const opening = Number(parsed.openingBalance);
      if (opening === 0) {
        continue;
      }
      openingBalances += 1;
      rows.push({
        groupId: group.id,
        type: opening > 0 ? TransactionType.INCOME : TransactionType.EXPENSE,
        date: new Date(firstDate.getTime() - OPENING_BALANCE_OFFSET_MS),
        amount: Math.abs(opening).toFixed(2),
        currencyId: currencyOf.get(parsed.sourceId),
        accountId: accountIds.get(parsed.sourceId),
        categoryId: null,
        subcategoryId: null,
        toAccountId: null,
        destAmount: null,
        note: OPENING_BALANCE_NOTE,
        createdBy: userId,
      });
    }

    const rules: RecurringRule[] = [];
    for (const parsed of backup.transactions) {
      const accountId = accountIds.get(parsed.accountSourceId);
      const toAccountId = parsed.toAccountSourceId === null ? null : (accountIds.get(parsed.toAccountSourceId) ?? null);
      if (!accountId || (parsed.type === 'transfer' && !toAccountId)) {
        continue;
      }
      const categoryId = parsed.categorySourceId === null ? null : (categoryIds.get(parsed.categorySourceId) ?? null);
      const fields = {
        groupId: group.id,
        type: parsed.type as TransactionType,
        amount: parsed.amount,
        currencyId: currencyOf.get(parsed.accountSourceId),
        accountId,
        categoryId,
        // Never without its category, which the table's own check would refuse.
        subcategoryId:
          categoryId === null || parsed.subcategorySourceId === null
            ? null
            : (categoryIds.get(parsed.subcategorySourceId) ?? null),
        toAccountId,
        note: parsed.note,
        createdBy: userId,
      };

      // A repeating entry becomes a rule starting at its next due date, which writes that date's
      // transaction itself. Not a transfer between currencies, though: a rule carries one amount
      // for both sides, so that one stays the single planned transaction it was.
      const oneCurrency = toAccountId === null || currencyOf.get(parsed.toAccountSourceId ?? -1) === fields.currencyId;
      if (parsed.recurrence && oneCurrency) {
        rules.push(
          this.rules.create({
            ...fields,
            intervalUnit: parsed.recurrence.unit as RecurrenceUnit,
            intervalValue: parsed.recurrence.value,
            startsAt: parsed.date,
            nextRunDate: parsed.date,
            reminderDaysBefore: null,
            timezone,
            active: true,
          }),
        );
        continue;
      }
      rows.push({ ...fields, date: parsed.date, destAmount: parsed.destAmount });
    }

    for (let from = 0; from < rows.length; from += INSERT_CHUNK) {
      await this.transactions.insert(rows.slice(from, from + INSERT_CHUNK));
    }
    const now = new Date();
    for (const rule of await this.rules.save(rules)) {
      await materializeOccurrences(this.rules.manager, rule, now, this.rates.lookup);
    }

    return {
      groupId: group.id,
      groupName: group.name,
      accounts: accountIds.size,
      categories: bySiblingName.size,
      transactions: rows.length - openingBalances,
      plannedTransactions: await this.transactions.countBy({ groupId: group.id, date: MoreThan(now) }),
      recurringRules: rules.length,
      openingBalances,
      balances: await this.balances(userId, group.id),
    };
  }

  private async currencyIdsByCode(backup: ParsedBackup): Promise<Map<string, number>> {
    const codes = [...new Set(backup.accounts.map((account) => account.currencyCode))];
    const known = await this.currencies.find({ where: { code: In(codes) } });
    const missing = codes.filter((code) => !known.some((currency) => currency.code === code));
    if (missing.length > 0) {
      throw new UnprocessableEntityException(`Currencies not supported yet: ${missing.join(', ')}`);
    }
    return new Map(known.map((currency) => [currency.code, currency.id]));
  }

  // Read back what the import amounts to, so the caller can check it against the old app without
  // a second request. Through the accounts service, so these are balances in the app's own sense:
  // what has already happened, with planned transactions left out.
  private async balances(userId: string, groupId: string): Promise<ImportSummary['balances']> {
    const withBalances = await this.accountsService.list(userId, groupId, true);
    const codes = new Map((await this.currencies.find()).map((currency) => [currency.id, currency.code]));
    return withBalances.map(({ account, balance }) => ({
      name: account.name,
      currency: codes.get(account.currencyId) ?? String(account.currencyId),
      balance,
    }));
  }
}
