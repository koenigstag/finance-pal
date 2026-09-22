/**
 * The Finance Pal file: a group's transactions, accounts, categories and repeating series as four
 * tables, the way a spreadsheet holds them. An .xlsx workbook carries all four as sheets; a CSV file
 * carries one. Export writes them and import reads them back into a new group — or reads tables
 * someone filled in by hand, which is why reading is lenient where writing is strict: headers in any
 * case and spacing, columns in any order, columns of their own left alone.
 *
 * Accounts and categories are named, never quoted by id, so a file reads (and can be written) by a
 * person: an account is its name and currency, a category its type, parent and name. A series has
 * no name, so the Series table numbers its rows and a transaction refers to one by that number.
 *
 * docs/data-files.md describes every column for people; this file is what the code goes by.
 */

export const TABLE_NAMES = ['transactions', 'accounts', 'categories', 'series'] as const;
export type TableName = (typeof TABLE_NAMES)[number];

/**
 * How a column's cells are written and read:
 * - `text`: as is.
 * - `money`: an amount, never negative (a transaction's direction is its type), written with two
 *   decimals.
 * - `balance`: an amount that may be negative.
 * - `percentage`: 12.5 for 12.5%.
 * - `integer`: a whole number.
 * - `boolean`: true or false.
 * - `datetime`: a local date and time, in the zone the file is written or read for.
 */
export type ColumnType = 'text' | 'money' | 'balance' | 'percentage' | 'integer' | 'boolean' | 'datetime';

/**
 * A cell, whichever file it comes from or goes to:
 * - text, as a string;
 * - a number as the decimal text it was written as, never a JavaScript number, so money stays
 *   exact. Writing, it's a plain string in a numeric column; read from an .xlsx number cell, it's
 *   tagged (NumberCell), since there it's a number the spreadsheet stored, not text someone typed;
 * - a boolean;
 * - a date and time as a Date whose UTC fields are the local time (see wallClock), which is what a
 *   spreadsheet stores: a calendar date and a clock time, without a zone;
 * - null for an empty cell.
 */
export type Cell = string | NumberCell | boolean | Date | null;

export interface NumberCell {
  number: string;
}

export function isNumberCell(cell: Cell): cell is NumberCell {
  return typeof cell === 'object' && cell !== null && !(cell instanceof Date);
}

export interface ColumnSpec<K extends string = string> {
  key: K;
  header: string;
  type: ColumnType;
  // In characters, for the .xlsx sheet.
  width: number;
  // Other headers a table made elsewhere may use for it, as normalizeHeader leaves them.
  aliases?: readonly string[];
}

export interface TableSpec<K extends string = string> {
  name: TableName;
  // The sheet's name in a workbook, and the word that ends a CSV file's name.
  title: string;
  columns: readonly ColumnSpec<K>[];
  // Without these, a sheet isn't this table.
  required: readonly K[];
}

function table<const K extends string>(spec: TableSpec<K>): TableSpec<K> {
  return spec;
}

// The columns a transaction and a series share: what moves, from where to where, filed under what.
const MONEY_MOVEMENT = [
  { key: 'type', header: 'Type', type: 'text', width: 10 },
  { key: 'amount', header: 'Amount', type: 'money', width: 13 },
  { key: 'currency', header: 'Currency', type: 'text', width: 9 },
  { key: 'account', header: 'Account', type: 'text', width: 22 },
  { key: 'category', header: 'Category', type: 'text', width: 20 },
  { key: 'subcategory', header: 'Subcategory', type: 'text', width: 20 },
  { key: 'toAccount', header: 'To account', type: 'text', width: 22 },
] as const;

const AMOUNT_SOURCE = [
  { key: 'percentage', header: 'Percentage', type: 'percentage', width: 11 },
  { key: 'baseAmount', header: 'Base amount', type: 'money', width: 13 },
  { key: 'roundBalanceTo', header: 'Round balance to', type: 'integer', width: 10 },
] as const;

const NOTE = { key: 'note', header: 'Note', type: 'text', width: 32, aliases: ['comment', 'memo'] } as const;
const CURRENCY_RECEIVED = { key: 'currencyReceived', header: 'Currency received', type: 'text', width: 9 } as const;

export const TRANSACTIONS = table({
  name: 'transactions',
  title: 'Transactions',
  columns: [
    { key: 'date', header: 'Date', type: 'datetime', width: 17 },
    ...MONEY_MOVEMENT,
    { key: 'amountReceived', header: 'Amount received', type: 'money', width: 13 },
    CURRENCY_RECEIVED,
    NOTE,
    { key: 'tags', header: 'Tags', type: 'text', width: 16 },
    ...AMOUNT_SOURCE,
    { key: 'series', header: 'Series', type: 'integer', width: 8 },
  ],
  required: ['date', 'type', 'amount', 'account'],
});

export const ACCOUNTS = table({
  name: 'accounts',
  title: 'Accounts',
  columns: [
    { key: 'name', header: 'Name', type: 'text', width: 22 },
    { key: 'currency', header: 'Currency', type: 'text', width: 9 },
    { key: 'type', header: 'Type', type: 'text', width: 10 },
    { key: 'balance', header: 'Balance', type: 'balance', width: 14 },
    { key: 'includeInTotal', header: 'Include in total', type: 'boolean', width: 10 },
    { key: 'favourite', header: 'Favourite', type: 'boolean', width: 10, aliases: ['favorite'] },
    { key: 'archived', header: 'Archived', type: 'boolean', width: 10 },
    { key: 'description', header: 'Description', type: 'text', width: 32 },
    { key: 'icon', header: 'Icon', type: 'text', width: 16 },
    { key: 'color', header: 'Color', type: 'text', width: 10, aliases: ['colour'] },
    { key: 'limit', header: 'Limit', type: 'money', width: 13 },
    { key: 'goal', header: 'Goal', type: 'money', width: 13 },
  ],
  required: ['name', 'currency'],
});

export const CATEGORIES = table({
  name: 'categories',
  title: 'Categories',
  columns: [
    { key: 'name', header: 'Name', type: 'text', width: 22 },
    { key: 'type', header: 'Type', type: 'text', width: 10 },
    { key: 'parent', header: 'Parent', type: 'text', width: 22 },
    { key: 'icon', header: 'Icon', type: 'text', width: 16 },
    { key: 'color', header: 'Color', type: 'text', width: 10, aliases: ['colour'] },
    { key: 'archived', header: 'Archived', type: 'boolean', width: 10 },
  ],
  required: ['name', 'type'],
});

export const SERIES = table({
  name: 'series',
  title: 'Series',
  columns: [
    { key: 'series', header: 'Series', type: 'integer', width: 8 },
    ...MONEY_MOVEMENT,
    CURRENCY_RECEIVED,
    NOTE,
    ...AMOUNT_SOURCE,
    { key: 'repeat', header: 'Repeat', type: 'text', width: 9, aliases: ['unit', 'period'] },
    { key: 'every', header: 'Every', type: 'integer', width: 7, aliases: ['interval'] },
    { key: 'start', header: 'Start', type: 'datetime', width: 17, aliases: ['startsat', 'startdate'] },
    { key: 'nextDate', header: 'Next date', type: 'datetime', width: 17, aliases: ['next'] },
    { key: 'timezone', header: 'Time zone', type: 'text', width: 16 },
    { key: 'active', header: 'Active', type: 'boolean', width: 8 },
    { key: 'remindDaysBefore', header: 'Remind days before', type: 'integer', width: 10, aliases: ['reminder'] },
  ],
  required: ['type', 'amount', 'account', 'repeat'],
});

// In the order a workbook holds them: what people open the file for first.
export const TABLES = [TRANSACTIONS, ACCOUNTS, CATEGORIES, SERIES] as const;

export type TransactionColumn = (typeof TRANSACTIONS.columns)[number]['key'];
export type AccountColumn = (typeof ACCOUNTS.columns)[number]['key'];
export type CategoryColumn = (typeof CATEGORIES.columns)[number]['key'];
export type SeriesColumn = (typeof SERIES.columns)[number]['key'];

export function tableSpec(name: TableName): TableSpec {
  return TABLES.find((spec) => spec.name === name) as TableSpec;
}

/** Headers compare as letters and digits alone: "To account", "to_account" and "toAccount" match. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// A header row's cells as text; anything else there (a number, a date) names no column of ours.
function headerTexts(row: readonly Cell[]): string[] {
  return row.map((cell) => (typeof cell === 'string' ? normalizeHeader(cell) : ''));
}

/** Where each of the table's columns is in a header row: the first cell naming it, if any does. */
export function locateColumns<K extends string>(spec: TableSpec<K>, header: readonly Cell[]): Map<K, number> {
  const texts = headerTexts(header);
  const located = new Map<K, number>();
  for (const column of spec.columns) {
    const names = [column.header, ...(column.aliases ?? [])].map(normalizeHeader);
    const index = texts.findIndex((text) => names.includes(text));
    if (index >= 0) {
      located.set(column.key, index);
    }
  }
  return located;
}

function hasRequired(spec: TableSpec, header: readonly Cell[]): boolean {
  const located = locateColumns(spec, header);
  return spec.required.every((key) => located.has(key));
}

// Tried in this order: a series has what a transaction has and more, and an account has what a
// category has (a name and a type) and a currency.
const RECOGNITION_ORDER = [SERIES, TRANSACTIONS, ACCOUNTS, CATEGORIES] as const;

/**
 * Which table a sheet holds. A workbook's sheet says so by its name ("Transactions"); anything else —
 * a sheet renamed, a CSV file — by its header row, where the name of the file breaks a tie.
 */
export function recognizeTable(header: readonly Cell[], names: { sheet?: string; file?: string }): TableSpec | null {
  if (names.sheet !== undefined) {
    const sheet = normalizeHeader(names.sheet);
    const named = TABLES.find((spec) => normalizeHeader(spec.title) === sheet);
    if (named) {
      return named;
    }
  }
  const fits: TableSpec[] = RECOGNITION_ORDER.filter((spec) => hasRequired(spec, header));
  if (fits.length > 1 && names.file !== undefined) {
    const file = normalizeHeader(names.file);
    const mentioned = fits.filter((spec) => file.includes(normalizeHeader(spec.title)));
    if (mentioned.length === 1) {
      return mentioned[0];
    }
  }
  return fits[0] ?? null;
}
