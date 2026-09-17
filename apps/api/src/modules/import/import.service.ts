import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import {
  Account,
  Category,
  Currency,
  Group,
  GroupMember,
  MemberRole,
  Transaction,
  TransactionType,
} from '@ft/api-database';
import { AccountsService } from '../ledger/accounts/accounts.service';
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
  // Transactions dated in the future, which show up as planned.
  plannedTransactions: number;
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
    private readonly accountsService: AccountsService,
  ) {}

  /** Writes a parsed backup as a brand-new group owned by the caller. */
  @Transactional()
  async importBackup(userId: string, groupName: string, backup: ParsedBackup): Promise<ImportSummary> {
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
          type: parsed.type,
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
    // added); here they become one, and both source ids point at it.
    const categoryIds = new Map<number, string>();
    const byNameAndType = new Map<string, string>();
    for (const parsed of backup.categories) {
      const key = `${parsed.type}:${parsed.name.toLocaleLowerCase()}`;
      let id = byNameAndType.get(key);
      if (!id) {
        const category = await this.categories.save(
          this.categories.create({
            groupId: group.id,
            name: parsed.name,
            type: parsed.type,
            color: parsed.color,
            archived: parsed.archived,
            archivedAt: parsed.archived ? new Date() : null,
            createdBy: userId,
          }),
        );
        id = category.id;
        byNameAndType.set(key, id);
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
        toAccountId: null,
        destAmount: null,
        note: OPENING_BALANCE_NOTE,
        createdBy: userId,
      });
    }

    const now = Date.now();
    let planned = 0;
    for (const parsed of backup.transactions) {
      const accountId = accountIds.get(parsed.accountSourceId);
      const toAccountId = parsed.toAccountSourceId === null ? null : (accountIds.get(parsed.toAccountSourceId) ?? null);
      if (!accountId || (parsed.type === TransactionType.TRANSFER && !toAccountId)) {
        continue;
      }
      if (parsed.date.getTime() > now) {
        planned += 1;
      }
      rows.push({
        groupId: group.id,
        type: parsed.type,
        date: parsed.date,
        amount: parsed.amount,
        currencyId: currencyOf.get(parsed.accountSourceId),
        accountId,
        categoryId: parsed.categorySourceId === null ? null : (categoryIds.get(parsed.categorySourceId) ?? null),
        toAccountId,
        destAmount: parsed.destAmount,
        note: parsed.note,
        createdBy: userId,
      });
    }

    for (let from = 0; from < rows.length; from += INSERT_CHUNK) {
      await this.transactions.insert(rows.slice(from, from + INSERT_CHUNK));
    }

    return {
      groupId: group.id,
      groupName: group.name,
      accounts: accountIds.size,
      categories: byNameAndType.size,
      transactions: rows.length - openingBalances,
      plannedTransactions: planned,
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
