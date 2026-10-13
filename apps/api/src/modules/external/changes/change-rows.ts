import type { RealtimeResourceType } from '@ft/shared-contracts';

// What a change set's recorded rows add up to: each row a change touched, as it was before the
// change and as the change left it — what undoing it puts back, what an answer shows of it, and
// what stands in the way of undoing it.

/** The tables a change is recorded in, as 20261013180000-create-change-sets puts its trigger on. */
export const RECORDED_TABLES = ['transactions', 'accounts', 'categories', 'budgets', 'recurring_rules', 'category_rules'] as const;
export type RecordedTable = (typeof RECORDED_TABLES)[number];

export function isRecordedTable(table: string): table is RecordedTable {
  return (RECORDED_TABLES as readonly string[]).includes(table);
}

/** A row as to_jsonb() gives it: its columns by name. */
export type Row = Record<string, unknown>;

/** One write the trigger recorded, in the order they came. */
export interface RecordedWrite {
  seq: number;
  table: RecordedTable;
  rowId: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  oldRow: Row | null;
  newRow: Row | null;
}

/** A row a change touched, however many times: as it was before (null: it wasn't there) and after. */
export interface TouchedRow {
  table: RecordedTable;
  rowId: string;
  // Where it first came, which undoing goes back over in reverse.
  firstSeq: number;
  before: Row | null;
  after: Row | null;
}

export const touchedKey = (table: string, rowId: string) => `${table}:${rowId}`;

/** Each row's first image before and last image after, in the order the change first touched them. */
export function collapse(writes: RecordedWrite[]): TouchedRow[] {
  const rows = new Map<string, TouchedRow>();
  for (const write of [...writes].sort((a, b) => a.seq - b.seq)) {
    const key = touchedKey(write.table, write.rowId);
    const seen = rows.get(key);
    if (seen) {
      seen.after = write.newRow;
    } else {
      rows.set(key, { table: write.table, rowId: write.rowId, firstSeq: write.seq, before: write.oldRow, after: write.newRow });
    }
  }
  // A row made and removed again within the change, or written back as it was, is no change.
  return [...rows.values()].filter((row) => !sameRow(row.table, row.before, row.after));
}

// Set on every write by its trigger, whatever the write was.
const ALWAYS_DIFFERENT = ['updated_at'];

/**
 * Columns a trigger keeps from other rows: an account's cached balance follows its transactions.
 * They're no part of what a change did to the row — a row where only they moved wasn't changed —
 * and undoing leaves them to their trigger, which brings them along as the transactions go back.
 */
export const KEPT_BY_TRIGGER: Partial<Record<RecordedTable, string[]>> = { accounts: ['cached_balance'] };

/**
 * Whether a row is as it was, as far as anyone would tell: its update time aside, and for a
 * transaction, the figures the app works out again on its own — an amount from the balance (a
 * percentage of it, or a rounding) follows the balance, and an amount converted at a rate follows
 * the rate, until their date.
 */
export function sameRow(table: RecordedTable, a: Row | null, b: Row | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  const ignored = new Set([...ALWAYS_DIFFERENT, ...(KEPT_BY_TRIGGER[table] ?? [])]);
  if (table === 'transactions') {
    if (worksAmountOut(a) || worksAmountOut(b)) {
      ignored.add('amount').add('percentage_as_of');
    }
    if (a.dest_amount_as_of != null || b.dest_amount_as_of != null) {
      ignored.add('dest_amount').add('dest_amount_as_of');
    }
  }
  const columns = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...columns].every((column) => ignored.has(column) || sameValue(a[column], b[column]));
}

function worksAmountOut(row: Row): boolean {
  return row.percentage != null || row.round_balance_to != null;
}

function sameValue(a: unknown, b: unknown): boolean {
  // Both from to_jsonb(), so equal values are spelled alike; a timestamp may come back with its
  // offset written differently, though, so moments compare as moments.
  if (typeof a === 'string' && typeof b === 'string' && a !== b && MOMENT.test(a) && MOMENT.test(b)) {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** What keeps a change from being undone, row by row. */
export interface UndoBlocker {
  what: string;
  id: string;
  label: string | null;
  reason: string;
}

/**
 * Why each touched row can't be put back, if it can't: it was changed since (by the person, by the
 * app, or by a later change), or it's a transaction that was planned when the change was made and
 * has happened since — what has happened stays, as the planned-only rule has it.
 */
export function undoBlockers(touched: TouchedRow[], current: Map<string, Row | null>, madeAt: Date, now: Date): UndoBlocker[] {
  const blockers: UndoBlocker[] = [];
  for (const row of touched) {
    const present = current.get(touchedKey(row.table, row.rowId)) ?? null;
    const blocker = (reason: string) => blockers.push({ what: WHAT[row.table], id: row.rowId, label: labelOf(row.table, row.after ?? row.before), reason });
    if (!sameRow(row.table, present, row.after)) {
      blocker(present === null ? 'it has been deleted since' : 'it has been changed since');
    } else if (row.table === 'transactions' && happenedSince(row, madeAt, now)) {
      blocker('it was planned then and has happened since: what has happened stays');
    }
  }
  return blockers;
}

function happenedSince(row: TouchedRow, madeAt: Date, now: Date): boolean {
  const dates = [row.before, row.after].filter((image): image is Row => image !== null).map((image) => new Date(String(image.date)));
  return dates.some((date) => date > madeAt) && dates.some((date) => date <= now);
}

/** Undoing goes back over the change in reverse: what it made last is taken away first. */
export function undoOrder(touched: TouchedRow[]): TouchedRow[] {
  return [...touched].sort((a, b) => b.firstSeq - a.firstSeq);
}

const WHAT: Record<RecordedTable, string> = {
  transactions: 'transaction',
  accounts: 'account',
  categories: 'category',
  budgets: 'budget line',
  recurring_rules: 'series',
  category_rules: 'category rule',
};

export const REALTIME_TYPE: Record<RecordedTable, RealtimeResourceType> = {
  transactions: 'Transaction',
  accounts: 'Account',
  categories: 'Category',
  budgets: 'Budget',
  recurring_rules: 'RecurringRule',
  category_rules: 'CategoryRule',
};

/** One row as an answer shows what was done to it. */
export interface DiffEntry {
  what: string;
  id: string;
  change: 'added' | 'changed' | 'deleted' | 'restored';
  label: string | null;
  // Every field it was added with, or that it was deleted with; for a change, only what changed.
  before?: Row;
  after?: Row;
}

// What tells nothing about the row itself.
const HIDDEN = new Set([
  'id',
  'group_id',
  'created_at',
  'updated_at',
  'created_by',
  'deleted_at',
  'idempotency_key',
  'idempotency_fingerprint',
  ...Object.values(KEPT_BY_TRIGGER).flat(),
]);

/** What the change did to a row, in the terms an answer uses. */
export function diffOf(row: TouchedRow): DiffEntry {
  const { before, after } = row;
  const base = { what: WHAT[row.table], id: row.rowId, label: labelOf(row.table, after ?? before) };
  if (before === null || (before.deleted_at != null && after !== null && after.deleted_at == null)) {
    return { ...base, change: before === null ? 'added' : 'restored', after: visible(after as Row) };
  }
  if (after === null || (after.deleted_at != null && before.deleted_at == null)) {
    return { ...base, change: 'deleted', before: visible(before) };
  }
  const changed = Object.keys({ ...before, ...after }).filter((column) => !HIDDEN.has(column) && !sameValue(before[column], after[column]));
  return { ...base, change: 'changed', before: pick(before, changed), after: pick(after, changed) };
}

/** What undoing the change would do to a row: the change, the other way round. */
export function undoDiffOf(row: TouchedRow): DiffEntry {
  return diffOf({ ...row, before: row.after, after: row.before });
}

function visible(row: Row): Row {
  return pick(row, Object.keys(row).filter((column) => !HIDDEN.has(column) && row[column] !== null));
}

function pick(row: Row, columns: string[]): Row {
  return Object.fromEntries(columns.map((column) => [camelCase(column), row[column] ?? null]));
}

const camelCase = (column: string) => column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** How a row is told apart in an answer: a name, or for money, what it is and when. */
function labelOf(table: RecordedTable, row: Row | null): string | null {
  if (row === null) {
    return null;
  }
  switch (table) {
    case 'accounts':
    case 'categories':
      return typeof row.name === 'string' ? row.name : null;
    case 'transactions':
      return [row.type, row.amount, row.note, `on ${String(row.date).slice(0, 10)}`].filter((part) => part != null && part !== '').join(' ');
    case 'recurring_rules':
      return [row.type, row.amount, row.note, `every ${String(row.interval_value)} ${String(row.interval_unit)}`]
        .filter((part) => part != null && part !== '')
        .join(' ');
    case 'budgets':
      return `${String(row.month).slice(0, 7)}: ${String(row.amount)}`;
    case 'category_rules':
      return typeof row.pattern === 'string' ? row.pattern : null;
  }
}
