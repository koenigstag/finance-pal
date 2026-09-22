import type { ACCOUNT_TYPES, CATEGORY_TYPES, RECURRENCE_UNITS, TRANSACTION_TYPES } from '@ft/shared-contracts';
import { normalizeName } from '../external/references';
import { ACCOUNTS, CATEGORIES, SERIES, TRANSACTIONS, type Cell, type TableSpec } from './tables';
import { trimPercentage, wallClock } from './values';

// The shared string unions rather than the database's enums: this file works on plain data, and
// api-database wants a configured environment the moment it's imported.
type AccountType = (typeof ACCOUNT_TYPES)[number];
type CategoryType = (typeof CATEGORY_TYPES)[number];
type TransactionType = (typeof TRANSACTION_TYPES)[number];
type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export interface SnapshotAccount {
  id: string;
  name: string;
  // ISO code.
  currency: string;
  type: AccountType;
  // What it holds now, planned transactions aside: what the app shows.
  balance: string;
  isIncludedInBalance: boolean;
  isFavourite: boolean;
  archived: boolean;
  description: string | null;
  icon: string | null;
  color: string | null;
  limitAmount: string | null;
  goalAmount: string | null;
}

export interface SnapshotCategory {
  id: string;
  parentId: string | null;
  type: CategoryType;
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
}

// What a transaction and a series both carry.
interface MoneyMovement {
  type: TransactionType;
  amount: string;
  accountId: string;
  categoryId: string | null;
  subcategoryId: string | null;
  toAccountId: string | null;
  note: string | null;
  percentage: string | null;
  percentageBase: string | null;
  roundBalanceTo: number | null;
}

export interface SnapshotTransaction extends MoneyMovement {
  date: Date;
  destAmount: string | null;
  destAmountAsOf: Date | null;
  tags: string[];
  recurringRuleId: string | null;
  recurrenceDate: Date | null;
}

export interface SnapshotSeries extends MoneyMovement {
  id: string;
  intervalUnit: RecurrenceUnit;
  intervalValue: number;
  startsAt: Date;
  // The date it next produces a transaction; null while paused.
  nextOccurrence: Date | null;
  timezone: string;
  active: boolean;
  reminderDaysBefore: number | null;
}

/**
 * A group's data as the export writes it, each list in the order the file lists it: accounts and
 * series as the app lists them, categories by type with every top-level category followed by its
 * subcategories, transactions oldest first. Nothing deleted.
 */
export interface GroupSnapshot {
  accounts: SnapshotAccount[];
  categories: SnapshotCategory[];
  transactions: SnapshotTransaction[];
  series: SnapshotSeries[];
}

export interface ExportedTable {
  spec: TableSpec;
  // In the order of spec.columns.
  rows: Cell[][];
}

export interface ExportOptions {
  // Dates are written as local times in this zone, except a series' own, which are in the series'.
  timezone: string;
  now: Date;
}

/** The four tables of the Finance Pal file for a group, as a workbook holds them. */
export function exportTables(snapshot: GroupSnapshot, { timezone, now }: ExportOptions): ExportedTable[] {
  // An account is named by its name and currency, a category by its type, parent and name — and
  // two with the same would read as one when the file comes back, so the later gets a number.
  const accountNames = uniqueNames(snapshot.accounts, (account) => account.currency);
  const categoryNames = uniqueNames(snapshot.categories, (category) => `${category.type}|${category.parentId ?? ''}`);
  const accounts = new Map(snapshot.accounts.map((account) => [account.id, account]));
  const seriesNumbers = new Map(snapshot.series.map((series, index) => [series.id, index + 1]));
  const planned = plannedOccurrences(snapshot, now);

  const movement = (item: MoneyMovement) => {
    const toAccount = item.toAccountId ? accounts.get(item.toAccountId) : undefined;
    return {
      type: item.type,
      amount: item.amount,
      currency: accounts.get(item.accountId)?.currency ?? null,
      account: accountNames.get(item.accountId) ?? null,
      category: item.categoryId ? (categoryNames.get(item.categoryId) ?? null) : null,
      subcategory: item.subcategoryId ? (categoryNames.get(item.subcategoryId) ?? null) : null,
      toAccount: item.toAccountId ? (accountNames.get(item.toAccountId) ?? null) : null,
      currencyReceived: toAccount?.currency ?? null,
      note: item.note || null,
      percentage: item.percentage === null ? null : trimPercentage(item.percentage),
      baseAmount: item.percentageBase,
      roundBalanceTo: item.roundBalanceTo === null ? null : String(item.roundBalanceTo),
    };
  };

  const transactions = snapshot.transactions
    // Never so in the app: an account takes its transactions with it when it's deleted.
    .filter((transaction) => accounts.has(transaction.accountId))
    .map((transaction) => {
      const series = planned.has(transaction) && transaction.recurringRuleId ? seriesNumbers.get(transaction.recurringRuleId) : undefined;
      return row(TRANSACTIONS, {
        date: wallClock(transaction.date, timezone),
        ...movement(transaction),
        amountReceived: receivedAmount(transaction),
        tags: transaction.tags.length > 0 ? transaction.tags.join(', ') : null,
        series: series === undefined ? null : String(series),
      });
    });

  const accountRows = snapshot.accounts.map((account) =>
    row(ACCOUNTS, {
      name: accountNames.get(account.id) ?? account.name,
      currency: account.currency,
      type: account.type,
      balance: account.balance,
      includeInTotal: account.isIncludedInBalance,
      favourite: account.isFavourite,
      archived: account.archived,
      description: account.description || null,
      icon: account.icon,
      color: account.color,
      limit: account.limitAmount,
      goal: account.goalAmount,
    }),
  );

  const categoryRows = snapshot.categories.map((category) =>
    row(CATEGORIES, {
      name: categoryNames.get(category.id) ?? category.name,
      type: category.type,
      parent: category.parentId ? (categoryNames.get(category.parentId) ?? null) : null,
      icon: category.icon,
      color: category.color,
      archived: category.archived,
    }),
  );

  const seriesRows = snapshot.series
    .filter((series) => accounts.has(series.accountId))
    .map((series) =>
      row(SERIES, {
        series: String(seriesNumbers.get(series.id)),
        ...movement(series),
        repeat: series.intervalUnit,
        every: String(series.intervalValue),
        // In the series' own zone: "the 1st of every month" is the 1st there.
        start: wallClock(series.startsAt, series.timezone),
        nextDate: series.nextOccurrence ? wallClock(series.nextOccurrence, series.timezone) : null,
        timezone: series.timezone,
        active: series.active,
        remindDaysBefore: series.reminderDaysBefore === null ? null : String(series.reminderDaysBefore),
      }),
    );

  return [
    { spec: TRANSACTIONS, rows: transactions },
    { spec: ACCOUNTS, rows: accountRows },
    { spec: CATEGORIES, rows: categoryRows },
    { spec: SERIES, rows: seriesRows },
  ];
}

function row<K extends string>(spec: TableSpec<K>, cells: Partial<Record<K, Cell>>): Cell[] {
  return spec.columns.map((column) => cells[column.key] ?? null);
}

/**
 * Names that tell the items apart within a scope (an account's currency, a category's type and
 * parent), compared the way import compares them: the first keeps its own, the next gets " (2)".
 */
function uniqueNames<T extends { id: string; name: string }>(items: readonly T[], scope: (item: T) => string): Map<string, string> {
  const taken = new Set<string>();
  const names = new Map<string, string>();
  for (const item of items) {
    const key = (name: string) => `${scope(item)}|${normalizeName(name)}`;
    let name = item.name;
    for (let copy = 2; taken.has(key(name)); copy++) {
      name = `${item.name} (${copy})`;
    }
    taken.add(key(name));
    names.set(item.id, name);
  }
  return names;
}

/**
 * The transaction each running series has planned — ahead of now by its date and by the date it was
 * scheduled for, the earliest if there are more — which the file marks with the series' number so
 * that it carries on as the series' own. Everything else a series wrote has happened, and stands
 * alone the way the app shows it.
 */
function plannedOccurrences(snapshot: GroupSnapshot, now: Date): Set<SnapshotTransaction> {
  const running = new Set(snapshot.series.filter((series) => series.active).map((series) => series.id));
  const earliest = new Map<string, SnapshotTransaction>();
  for (const transaction of snapshot.transactions) {
    const { recurringRuleId: ruleId, recurrenceDate } = transaction;
    if (!ruleId || !running.has(ruleId) || !recurrenceDate) {
      continue;
    }
    if (transaction.date.getTime() <= now.getTime() || recurrenceDate.getTime() <= now.getTime()) {
      continue;
    }
    const current = earliest.get(ruleId);
    if (!current || recurrenceDate.getTime() < (current.recurrenceDate as Date).getTime()) {
      earliest.set(ruleId, transaction);
    }
  }
  return new Set(earliest.values());
}

/**
 * What a transfer between two currencies received. Left empty while it's an estimate — converted at
 * the latest rate ahead of its date — so that it's converted again when the file comes back, and
 * keeps following the rate until the day, as it does here.
 */
function receivedAmount(transaction: SnapshotTransaction): string | null {
  const { destAmount, destAmountAsOf, date } = transaction;
  if (destAmount === null || (destAmountAsOf !== null && destAmountAsOf.getTime() < date.getTime())) {
    return null;
  }
  return destAmount;
}
