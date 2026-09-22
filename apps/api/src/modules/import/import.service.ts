import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import {
  Account,
  AccountTarget,
  AccountType,
  Category,
  CategoryType,
  Currency,
  Group,
  GroupMember,
  MemberRole,
  RecurrenceUnit,
  RecurringRule,
  Tag,
  Transaction,
  TransactionTag,
  TransactionType,
} from '@ft/api-database';
import type { ImportPlan, PlannedTransaction } from '../data-file/import-plan';
import { AccountsService } from '../ledger/accounts/accounts.service';
import { ExchangeRatesService } from '../ledger/exchange-rates/exchange-rates.service';
import { convertedDest } from '../ledger/transactions/dest-amount';
import { reworkEstimates } from '../recurring/balance-estimates';
import { isFromBalance } from '../recurring/derived-amount';
import { materializeOccurrences } from '../recurring/occurrence-materializer';
import { reworkRateEstimates } from '../recurring/rate-estimates';
import { startOfLocalDay } from '../recurring/recurrence-dates';
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
    @InjectRepository(AccountTarget) private readonly targets: Repository<AccountTarget>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionTag) private readonly transactionTags: Repository<TransactionTag>,
    @InjectRepository(RecurringRule) private readonly rules: Repository<RecurringRule>,
    private readonly accountsService: AccountsService,
    private readonly rates: ExchangeRatesService,
  ) {}

  /** The ISO codes of the currencies the app has, which a file's accounts must be in. */
  async currencyCodes(): Promise<Set<string>> {
    return new Set((await this.currencies.find()).map((currency) => currency.code));
  }

  /**
   * Writes a Finance Pal file, planned by planImport, as a brand-new group owned by the caller.
   * `timezone` is the one the file was read in; an opening balance is dated at the start of its
   * today, ahead of anything planned.
   */
  @Transactional()
  async importFinancePal(
    userId: string,
    groupName: string,
    plan: ImportPlan,
    { timezone, now }: { timezone: string; now: Date },
  ): Promise<ImportSummary> {
    const currencyIds = await this.currencyIdsFor(plan.accounts.map((account) => account.currency));
    const group = await this.groups.save(this.groups.create({ name: groupName, ownerId: userId }));
    await this.members.save(this.members.create({ groupId: group.id, userId, role: MemberRole.OWNER }));

    const accountIds = new Map<string, string>();
    const currencyOf = new Map<string, { id: number; code: string }>();
    for (const [sortOrder, planned] of plan.accounts.entries()) {
      const currencyId = currencyIds.get(planned.currency) as number;
      const account = await this.accounts.save(
        this.accounts.create({
          groupId: group.id,
          name: planned.name,
          description: planned.description,
          type: planned.type as AccountType,
          icon: planned.icon,
          color: planned.color,
          currencyId,
          isFavourite: planned.isFavourite,
          isIncludedInBalance: planned.isIncludedInBalance,
          archived: planned.archived,
          archivedAt: planned.archived ? now : null,
          sortOrder,
          createdBy: userId,
        }),
      );
      accountIds.set(planned.key, account.id);
      currencyOf.set(planned.key, { id: currencyId, code: planned.currency });
      if (planned.limitAmount !== null || planned.goalAmount !== null) {
        await this.targets.save(
          this.targets.create({ accountId: account.id, limitAmount: planned.limitAmount, goalAmount: planned.goalAmount }),
        );
      }
    }

    // Each takes its place among its siblings: the categories of its type at its level.
    const categoryIds = new Map<string, string>();
    const places = new Map<string, number>();
    for (const planned of plan.categories) {
      const siblings = `${planned.type}|${planned.parentKey ?? ''}`;
      const sortOrder = places.get(siblings) ?? 0;
      places.set(siblings, sortOrder + 1);
      const category = await this.categories.save(
        this.categories.create({
          groupId: group.id,
          parentId: planned.parentKey === null ? null : (categoryIds.get(planned.parentKey) as string),
          type: planned.type as CategoryType,
          name: planned.name,
          icon: planned.icon,
          color: planned.color,
          sortOrder,
          archived: planned.archived,
          archivedAt: planned.archived ? now : null,
          createdBy: userId,
        }),
      );
      categoryIds.set(planned.key, category.id);
    }

    const tagIds = new Map<string, string>();
    for (const name of plan.tags) {
      tagIds.set(name, (await this.tags.save(this.tags.create({ groupId: group.id, name }))).id);
    }

    const idOf = (keys: Map<string, string>, key: string | null) => (key === null ? null : (keys.get(key) as string));
    const rateBetween = this.cachedRates();

    // A transfer series between currencies converts each date at its rate, so one has to be had —
    // as when a series is set up in the app.
    const unconvertible = new Set<string>();
    for (const series of plan.series) {
      if (series.crossCurrency) {
        const [from, to] = [currencyOf.get(series.accountKey)?.code ?? '', currencyOf.get(series.toAccountKey as string)?.code ?? ''];
        if ((await rateBetween(from, to)) === null) {
          unconvertible.add(`${from} to ${to}`);
        }
      }
    }

    const ruleIds = new Map<number, string>();
    const rules: RecurringRule[] = [];
    for (const series of plan.series) {
      const rule = await this.rules.save(
        this.rules.create({
          groupId: group.id,
          type: series.type as TransactionType,
          amount: series.amount,
          currencyId: currencyOf.get(series.accountKey)?.id,
          accountId: idOf(accountIds, series.accountKey) as string,
          categoryId: idOf(categoryIds, series.categoryKey),
          subcategoryId: idOf(categoryIds, series.subcategoryKey),
          toAccountId: idOf(accountIds, series.toAccountKey),
          note: series.note,
          percentage: series.percentage,
          percentageBase: series.percentageBase,
          roundBalanceTo: series.roundBalanceTo,
          intervalUnit: series.intervalUnit as RecurrenceUnit,
          intervalValue: series.intervalValue,
          startsAt: series.startsAt,
          nextRunDate: series.nextRunDate,
          reminderDaysBefore: series.reminderDaysBefore,
          timezone: series.timezone,
          active: series.active,
          createdBy: userId,
        }),
      );
      ruleIds.set(series.number, rule.id);
      rules.push(rule);
    }

    const rows: Partial<Transaction>[] = [];
    const links: { transactionId: string; tagId: string }[] = [];
    for (const planned of plan.transactions) {
      const currency = currencyOf.get(planned.accountKey) as { id: number; code: string };
      const received = planned.toAccountKey === null ? undefined : currencyOf.get(planned.toAccountKey);
      const dest = await this.destOf(planned, currency.code, received?.code, rateBetween, now);
      if (dest === 'no rate') {
        unconvertible.add(`${currency.code} to ${received?.code}`);
        continue;
      }
      const id = randomUUID();
      rows.push({
        id,
        groupId: group.id,
        type: planned.type as TransactionType,
        date: planned.date,
        amount: planned.amount,
        currencyId: currency.id,
        accountId: idOf(accountIds, planned.accountKey) as string,
        categoryId: idOf(categoryIds, planned.categoryKey),
        subcategoryId: idOf(categoryIds, planned.subcategoryKey),
        toAccountId: idOf(accountIds, planned.toAccountKey),
        ...dest,
        percentage: planned.percentage,
        percentageBase: planned.percentageBase,
        roundBalanceTo: planned.roundBalanceTo,
        // Worked out from a balance: final for a date that's passed, and ahead of it an estimate
        // that follows the account (see reworkEstimates, below).
        percentageAsOf: isFromBalance(planned) ? now : null,
        note: planned.note,
        recurringRuleId: planned.occurrence ? (ruleIds.get(planned.occurrence.series) as string) : null,
        recurrenceDate: planned.occurrence?.recurrenceDate ?? null,
        isCustomized: planned.occurrence?.customized ?? false,
        createdBy: userId,
      });
      for (const tag of planned.tags) {
        links.push({ transactionId: id, tagId: tagIds.get(tag) as string });
      }
    }
    if (unconvertible.size > 0) {
      throw new BadRequestException(
        `There's no exchange rate from ${[...unconvertible].join(', from ')} right now: fill in Amount received for those transfers, and don't let them repeat`,
      );
    }

    let openingBalances = 0;
    const startOfToday = startOfLocalDay(now, timezone);
    for (const planned of plan.accounts) {
      if (planned.openingBalance === null) {
        continue;
      }
      openingBalances++;
      const negative = planned.openingBalance.startsWith('-');
      rows.push({
        id: randomUUID(),
        groupId: group.id,
        type: negative ? TransactionType.EXPENSE : TransactionType.INCOME,
        date: startOfToday,
        amount: negative ? planned.openingBalance.slice(1) : planned.openingBalance,
        currencyId: currencyOf.get(planned.key)?.id,
        accountId: accountIds.get(planned.key),
        categoryId: null,
        subcategoryId: null,
        toAccountId: null,
        destAmount: null,
        destAmountAsOf: null,
        percentage: null,
        percentageBase: null,
        roundBalanceTo: null,
        percentageAsOf: null,
        note: OPENING_BALANCE_NOTE,
        recurringRuleId: null,
        recurrenceDate: null,
        isCustomized: false,
        createdBy: userId,
      });
    }

    for (let from = 0; from < rows.length; from += INSERT_CHUNK) {
      await this.transactions.insert(rows.slice(from, from + INSERT_CHUNK));
    }
    for (let from = 0; from < links.length; from += INSERT_CHUNK) {
      await this.transactionTags.insert(links.slice(from, from + INSERT_CHUNK));
    }

    // A running series writes its planned transaction when the file had none for it, and catches
    // up on the dates it missed since the file was written.
    for (const rule of rules.filter((candidate) => candidate.active)) {
      await materializeOccurrences(this.rules.manager, rule, now, rateBetween);
    }
    // What's worked out from a balance or converted at a rate, and still ahead, follows what the
    // group now holds.
    const imported = [...accountIds.values()];
    await reworkEstimates(this.transactions.manager, imported, now);
    await reworkRateEstimates(this.transactions.manager, rateBetween, imported, now);

    return {
      groupId: group.id,
      groupName: group.name,
      accounts: plan.accounts.length,
      categories: plan.categories.length,
      transactions: plan.transactions.length,
      plannedTransactions: await this.transactions.countBy({ groupId: group.id, date: MoreThan(now) }),
      recurringRules: plan.series.length,
      openingBalances,
      balances: await this.balances(userId, group.id),
    };
  }

  /**
   * What a transfer received, as it's stored. Only one between two currencies receives anything of
   * its own: the figure the file gives, or else what was sent converted at the rate now — final for
   * a date that's passed, an estimate that follows the rate until the day for one ahead.
   */
  private async destOf(
    planned: PlannedTransaction,
    from: string,
    to: string | undefined,
    rateBetween: (from: string, to: string) => Promise<string | null>,
    now: Date,
  ): Promise<{ destAmount: string | null; destAmountAsOf: Date | null } | 'no rate'> {
    if (to === undefined || to === from) {
      return { destAmount: null, destAmountAsOf: null };
    }
    if (planned.destAmount !== null) {
      return { destAmount: planned.destAmount, destAmountAsOf: null };
    }
    const rate = await rateBetween(from, to);
    return rate === null ? 'no rate' : { destAmount: convertedDest(planned.amount, rate), destAmountAsOf: now };
  }

  // One lookup per pair of currencies for the whole import, however many rows share it.
  private cachedRates(): (from: string, to: string) => Promise<string | null> {
    const rates = new Map<string, Promise<string | null>>();
    return (from, to) => {
      const key = `${from}>${to}`;
      if (!rates.has(key)) {
        rates.set(key, this.rates.rateBetween(from, to));
      }
      return rates.get(key) as Promise<string | null>;
    };
  }

  private async currencyIdsFor(codes: string[]): Promise<Map<string, number>> {
    const known = await this.currencies.find({ where: { code: In([...new Set(codes)]) } });
    return new Map(known.map((currency) => [currency.code, currency.id]));
  }

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
