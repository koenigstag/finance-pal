import {
  ACCOUNT_TYPES,
  CATEGORY_TYPES,
  RECURRENCE_UNITS,
  TRANSACTION_TYPES,
  isRoundBalanceStep,
  isValidTimezone,
} from '@ft/shared-contracts';
import { normalizeName } from '../external/references';
import { firstIndexAtOrAfter, occurrenceAt, type Schedule } from '../recurring/recurrence-dates';
import {
  ACCOUNTS,
  CATEGORIES,
  SERIES,
  TRANSACTIONS,
  locateColumns,
  recognizeTable,
  type Cell,
  type CategoryColumn,
  type TableName,
  type TableSpec,
} from './tables';
import {
  CellProblem,
  readAmount,
  readBalance,
  readBoolean,
  readChoice,
  readDateTime,
  readInteger,
  readPercentage,
  readText,
} from './values';

type AccountType = (typeof ACCOUNT_TYPES)[number];
type CategoryType = (typeof CATEGORY_TYPES)[number];
type TransactionType = (typeof TRANSACTION_TYPES)[number];
type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

// The contracts' limits, which a file mustn't get past either.
const MAX_NAME = 120;
const MAX_TAG = 60;
const MAX_ICON = 40;
// Years of daily entries fit many times over; past it, a file is more likely a mistake than a history.
const MAX_ROWS = 100_000;
// Enough to fix a file by; a file that's wrong throughout would otherwise answer with thousands.
const MAX_PROBLEMS = 50;

/** Everything wrong with a file, each line saying where. The import writes nothing then. */
export class ImportProblems extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
  }
}

class Problems {
  readonly list: string[] = [];
  private count = 0;

  add(message: string): void {
    this.count++;
    if (this.list.length < MAX_PROBLEMS) {
      this.list.push(message);
    }
  }

  throwIfAny(): void {
    if (this.count === 0) {
      return;
    }
    const more = this.count - this.list.length;
    throw new ImportProblems(more > 0 ? [...this.list, `…and ${more} more`] : this.list);
  }
}

// ---------------------------------------------------------------------------------------------
// Finding the tables

/** A sheet of a workbook, or a CSV file, as it was read. */
export interface SourceSheet {
  // The file's name, and for a workbook the sheet's: what the person knows it by.
  file: string;
  sheet?: string;
  rows: Cell[][];
}

export interface TableRead {
  spec: TableSpec;
  // "Family.xlsx, sheet Transactions", for problems with the table as a whole.
  source: string;
  // Where each of the table's columns is.
  columns: Map<string, number>;
  // The data rows, each with its number in the sheet as a spreadsheet shows it.
  rows: { number: number; cells: Cell[] }[];
}

function isEmptyCell(cell: Cell | undefined): boolean {
  return cell === undefined || cell === null || (typeof cell === 'string' && cell.trim() === '');
}

/**
 * Which tables the files hold. The first row with anything in it is a table's header; empty rows
 * are skipped wherever they are. A workbook's sheets that are none of the four (notes of someone's
 * own, say) are left alone; a CSV file that isn't one of them is a mistake worth saying so.
 */
export function collectTables(sources: readonly SourceSheet[]): TableRead[] {
  const problems = new Problems();
  const found = new Map<TableName, TableRead>();

  for (const { file, sheet, rows } of sources) {
    const source = sheet === undefined ? file : `${file}, sheet ${sheet}`;
    const headerIndex = rows.findIndex((row) => row.some((cell) => !isEmptyCell(cell)));
    if (headerIndex < 0) {
      if (sheet === undefined) {
        problems.add(`${source} is empty`);
      }
      continue;
    }
    const header = rows[headerIndex];
    const spec = recognizeTable(header, { sheet, file });
    if (!spec) {
      if (sheet === undefined) {
        problems.add(`${source}: its first row doesn't name the columns of transactions, accounts, categories or series`);
      }
      continue;
    }
    const columns = locateColumns(spec, header);
    const missing = spec.required.filter((key) => !columns.has(key));
    if (missing.length > 0) {
      const headers = missing.map((key) => spec.columns.find((column) => column.key === key)?.header);
      problems.add(`${source}: ${spec.title} need a column for each of: ${headers.join(', ')}`);
      continue;
    }
    const earlier = found.get(spec.name);
    if (earlier) {
      problems.add(`${source} holds ${spec.title.toLowerCase()}, and so does ${earlier.source}: one table of each, please`);
      continue;
    }
    const data = rows
      .slice(headerIndex + 1)
      .map((cells, index) => ({ number: headerIndex + 2 + index, cells }))
      .filter(({ cells }) => cells.some((cell) => !isEmptyCell(cell)));
    if (data.length > MAX_ROWS) {
      problems.add(`${source}: more than ${MAX_ROWS} rows`);
      continue;
    }
    found.set(spec.name, { spec, source, columns, rows: data });
  }

  if (found.size === 0) {
    problems.add('None of the files holds transactions, accounts, categories or series');
  }
  problems.throwIfAny();
  return [...found.values()];
}

// ---------------------------------------------------------------------------------------------
// The plan

export interface PlannedAccount {
  key: string;
  name: string;
  // ISO code.
  currency: string;
  type: AccountType;
  isIncludedInBalance: boolean;
  isFavourite: boolean;
  archived: boolean;
  description: string | null;
  icon: string | null;
  color: string | null;
  limitAmount: string | null;
  goalAmount: string | null;
  // What the account starts with: its Balance, for an account none of the file's transactions touch.
  openingBalance: string | null;
}

export interface PlannedCategory {
  key: string;
  parentKey: string | null;
  type: CategoryType;
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
}

interface PlannedMovement {
  type: TransactionType;
  amount: string;
  accountKey: string;
  toAccountKey: string | null;
  categoryKey: string | null;
  subcategoryKey: string | null;
  note: string | null;
  percentage: string | null;
  percentageBase: string | null;
  roundBalanceTo: number | null;
}

export interface PlannedTransaction extends PlannedMovement {
  date: Date;
  // For a transfer between currencies: what arrived, or null to convert what was sent at the rate.
  destAmount: string | null;
  tags: string[];
  // Set on the transaction a running series has planned, which carries on as the series' own.
  occurrence: { series: number; recurrenceDate: Date; customized: boolean } | null;
}

export interface PlannedSeries extends PlannedMovement {
  number: number;
  intervalUnit: RecurrenceUnit;
  intervalValue: number;
  startsAt: Date;
  // The first date the series is yet to write: where it carries on from.
  nextRunDate: Date;
  timezone: string;
  active: boolean;
  reminderDaysBefore: number | null;
  // A transfer between currencies, which converts each date at its rate and so needs one to be had.
  crossCurrency: boolean;
}

export interface ImportPlan {
  // In the order the file lists them, which is the order the app will.
  accounts: PlannedAccount[];
  // Every category before its subcategories.
  categories: PlannedCategory[];
  tags: string[];
  transactions: PlannedTransaction[];
  series: PlannedSeries[];
}

export interface PlanOptions {
  // The zone local dates and times are read in, and a series without one of its own keeps.
  timezone: string;
  now: Date;
  // ISO codes of the currencies the app has.
  currencies: ReadonlySet<string>;
}

/**
 * What the tables will become in a new group, every reference between them resolved: accounts by
 * name (and currency, where the name alone isn't enough), categories by type and name, series by
 * number. Everything wrong with the file is found in one pass, and thrown together.
 *
 * A table may be missing. Without Accounts, the accounts transactions name are opened as they're
 * met, in the currency the row gives; without Categories, the same for categories. With the table
 * there, a name it doesn't have is a mistake — a typo would otherwise quietly open a second account.
 */
export function planImport(tables: readonly TableRead[], options: PlanOptions): ImportPlan {
  const problems = new Problems();
  const table = (name: TableName) => tables.find((candidate) => candidate.spec.name === name);
  const accountsTable = table('accounts');
  const categoriesTable = table('categories');
  const seriesTable = table('series');
  const transactionsTable = table('transactions');

  const context: Context = {
    options,
    problems,
    accounts: new AccountBook(accountsTable !== undefined),
    categories: new CategoryBook(categoriesTable !== undefined),
  };
  if (accountsTable) {
    readAccounts(accountsTable, context);
  } else {
    for (const naming of [transactionsTable, seriesTable]) {
      if (naming) {
        openNamedAccounts(naming, context);
      }
    }
  }
  if (categoriesTable) {
    readCategories(categoriesTable, context);
  }
  const series = seriesTable ? readSeries(seriesTable, context) : [];
  const transactions = transactionsTable ? readTransactions(transactionsTable, series, seriesTable !== undefined, context) : [];

  planSeries(series, transactions, context);
  planOpeningBalances(context.accounts.list, transactions);
  problems.throwIfAny();

  const tags = new Set<string>();
  for (const { transaction } of transactions) {
    transaction.tags.forEach((tag) => tags.add(tag));
  }
  return {
    accounts: context.accounts.list,
    categories: context.categories.ordered(),
    tags: [...tags],
    transactions: transactions.map(({ transaction }) => transaction),
    series: series.map(({ series: planned }) => planned),
  };
}

interface Context {
  options: PlanOptions;
  problems: Problems;
  accounts: AccountBook;
  categories: CategoryBook;
}

/** One data row, read cell by cell; a cell that can't be read spoils the row. */
class RowReader<K extends string> {
  failed = false;

  constructor(
    private readonly table: TableRead,
    readonly number: number,
    private readonly cells: Cell[],
    private readonly problems: Problems,
  ) {}

  private header(key: K): string {
    return this.table.spec.columns.find((column) => column.key === key)?.header ?? key;
  }

  private cell(key: K): Cell {
    const index = this.table.columns.get(key);
    return index === undefined ? null : (this.cells[index] ?? null);
  }

  /** Something wrong with the row. */
  problem(message: string): void {
    this.failed = true;
    this.problems.add(`${this.table.spec.title}, row ${this.number}: ${message}`);
  }

  read<T>(key: K, reader: (cell: Cell) => T | null): T | null {
    try {
      return reader(this.cell(key));
    } catch (error) {
      if (error instanceof CellProblem) {
        this.problem(`${this.header(key)}: ${error.message}`);
        return null;
      }
      throw error;
    }
  }

  required<T>(key: K, reader: (cell: Cell) => T | null): T | null {
    const value = this.read(key, reader);
    if (value === null && isEmptyCell(this.cell(key))) {
      this.problem(`${this.header(key)} is empty`);
    }
    return value;
  }

  text(key: K, max?: number): string | null {
    const text = this.read(key, readText);
    if (text !== null && max !== undefined && text.length > max) {
      this.problem(`${this.header(key)} is longer than ${max} characters`);
    }
    return text;
  }

  currency(key: K, known: ReadonlySet<string>, { required = false } = {}): string | null {
    const code = (required ? this.required(key, readText) : this.read(key, readText))?.toUpperCase() ?? null;
    if (code !== null && !known.has(code)) {
      this.problem(`${this.header(key)}: the app has no currency "${code}"`);
      return null;
    }
    return code;
  }

  color(key: K): string | null {
    const text = this.read(key, readText);
    if (text === null) {
      return null;
    }
    const color = text.startsWith('#') ? text : `#${text}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      this.problem(`${this.header(key)}: "${text}" isn't a colour like #3B82F6`);
      return null;
    }
    return color;
  }
}

function eachRow<K extends string>(table: TableRead, _spec: TableSpec<K>, problems: Problems, read: (row: RowReader<K>) => void): void {
  for (const { number, cells } of table.rows) {
    read(new RowReader<K>(table, number, cells, problems));
  }
}

// ---------------------------------------------------------------------------------------------
// Accounts

const accountKey = (name: string, currency: string) => `${currency}|${normalizeName(name)}`;

class AccountBook {
  readonly list: PlannedAccount[] = [];

  // `fixed`: the file has an Accounts table, and only its accounts exist.
  constructor(private readonly fixed: boolean) {}

  /** Opens an account a row names with its currency, unless the file lists its accounts itself. */
  open(name: string, currency: string): void {
    const key = accountKey(name, currency);
    if (this.fixed || this.list.some((account) => account.key === key)) {
      return;
    }
    this.list.push({
      key,
      name,
      currency,
      type: 'regular',
      isIncludedInBalance: true,
      isFavourite: false,
      archived: false,
      description: null,
      icon: null,
      color: null,
      limitAmount: null,
      goalAmount: null,
      openingBalance: null,
    });
  }

  /**
   * The account a row names by name and, when the row gives one in `currencyColumn`, currency; or
   * what's wrong.
   */
  resolve(name: string, currency: string | null, currencyColumn: string): PlannedAccount | string {
    const named = this.list.filter((account) => normalizeName(account.name) === normalizeName(name));
    const matches = currency === null ? named : named.filter((account) => account.currency === currency);
    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length > 1) {
      return `More than one account is named "${name}": fill in ${currencyColumn} to tell them apart`;
    }
    if (named.length > 0) {
      return `"${name}" is in ${named.map((account) => account.currency).join(' and ')}, not ${currency}`;
    }
    return this.fixed
      ? `There's no account named "${name}" in the Accounts table`
      : `"${name}" needs a currency to be opened in: fill in ${currencyColumn}, or add an Accounts table`;
  }
}

/**
 * Without an Accounts table, every account a row names together with its currency is opened, in
 * the order they first come up. Before any row is resolved, so that a transfer to an account whose
 * currency only a later row gives still finds it.
 */
function openNamedAccounts(table: TableRead, { accounts, options }: Context): void {
  const text = (cells: Cell[], key: string) => {
    const index = table.columns.get(key);
    try {
      return index === undefined ? null : readText(cells[index] ?? null);
    } catch {
      return null;
    }
  };
  for (const { cells } of table.rows) {
    for (const [nameColumn, currencyColumn] of [
      ['account', 'currency'],
      ['toAccount', 'currencyReceived'],
    ]) {
      const name = text(cells, nameColumn);
      const currency = text(cells, currencyColumn)?.toUpperCase();
      if (name !== null && currency !== undefined && options.currencies.has(currency)) {
        accounts.open(name, currency);
      }
    }
  }
}

function readAccounts(table: TableRead, { accounts, options, problems }: Context): void {
  const rowsByKey = new Map<string, number>();
  eachRow(table, ACCOUNTS, problems, (row) => {
    const name = row.required('name', readText);
    if (name !== null && name.length > MAX_NAME) {
      row.problem(`Name is longer than ${MAX_NAME} characters`);
    }
    const currency = row.currency('currency', options.currencies, { required: true });
    const type = row.read('type', (cell) => readChoice(cell, ACCOUNT_TYPES)) ?? 'regular';
    const openingBalance = row.read('balance', readBalance);
    const isIncludedInBalance = row.read('includeInTotal', readBoolean) ?? true;
    const isFavourite = row.read('favourite', readBoolean) ?? false;
    const archived = row.read('archived', readBoolean) ?? false;
    const description = row.text('description');
    const icon = row.text('icon', MAX_ICON);
    const color = row.color('color');
    const limitAmount = row.read('limit', readAmount);
    const goalAmount = row.read('goal', readAmount);
    if (row.failed || name === null || currency === null) {
      return;
    }

    const key = accountKey(name, currency);
    const earlier = rowsByKey.get(key);
    if (earlier !== undefined) {
      row.problem(`row ${earlier} is ${name} in ${currency} too, and accounts are told apart by name and currency`);
      return;
    }
    rowsByKey.set(key, row.number);
    accounts.list.push({
      key,
      name,
      currency,
      type,
      isIncludedInBalance,
      // One per group, the account new transactions start on: the first one marked.
      isFavourite: isFavourite && !accounts.list.some((other) => other.isFavourite),
      archived,
      description,
      icon,
      color,
      limitAmount,
      goalAmount,
      openingBalance,
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Categories

const topKey = (type: CategoryType, name: string) => `${type}|${normalizeName(name)}`;
const childKey = (parentKey: string, name: string) => `${parentKey}|${normalizeName(name)}`;
const otherType = (type: CategoryType): CategoryType => (type === 'expense' ? 'income' : 'expense');

type CategoryPair = { categoryKey: string | null; subcategoryKey: string | null };

class CategoryBook {
  private readonly all = new Map<string, PlannedCategory>();

  // `fixed`: the file has a Categories table, and only its categories exist.
  constructor(private readonly fixed: boolean) {}

  get(key: string): PlannedCategory | undefined {
    return this.all.get(key);
  }

  /** Adds it, unless one by that key is there already: two rows of the same category are one. */
  add(category: PlannedCategory): PlannedCategory {
    const existing = this.all.get(category.key);
    if (existing) {
      return existing;
    }
    this.all.set(category.key, category);
    return category;
  }

  // Parents first, each level in the order the rows came.
  ordered(): PlannedCategory[] {
    const list = [...this.all.values()];
    return [...list.filter((category) => category.parentKey === null), ...list.filter((category) => category.parentKey !== null)];
  }

  private open(type: CategoryType, name: string, parent: PlannedCategory | null): PlannedCategory {
    return this.add({
      key: parent ? childKey(parent.key, name) : topKey(type, name),
      parentKey: parent?.key ?? null,
      type,
      name,
      icon: null,
      color: null,
      archived: false,
    });
  }

  /**
   * What a transaction or a series is filed under: a top-level category of its type and, optionally,
   * one of its subcategories; or what's wrong. A subcategory named alone brings its category along
   * when there's only one of that name, and so does one named in place of the category.
   */
  resolve(type: CategoryType, categoryName: string | null, subcategoryName: string | null): CategoryPair | string {
    if (categoryName === null) {
      if (subcategoryName === null) {
        return { categoryKey: null, subcategoryKey: null };
      }
      const matches = this.subcategoriesNamed(type, subcategoryName);
      if (matches.length === 1) {
        return { categoryKey: matches[0].parentKey, subcategoryKey: matches[0].key };
      }
      return matches.length === 0
        ? `A subcategory needs its category: fill in Category for "${subcategoryName}"`
        : `More than one ${type} subcategory is named "${subcategoryName}": fill in its Category`;
    }

    let category = this.all.get(topKey(type, categoryName));
    if (!category) {
      if (this.fixed) {
        const asSubcategory = subcategoryName === null ? this.subcategoriesNamed(type, categoryName) : [];
        if (asSubcategory.length === 1) {
          return { categoryKey: asSubcategory[0].parentKey, subcategoryKey: asSubcategory[0].key };
        }
        return this.all.has(topKey(otherType(type), categoryName))
          ? `"${categoryName}" is an ${otherType(type)} category, and this is an ${type}`
          : `There's no ${type} category named "${categoryName}" in the Categories table`;
      }
      category = this.open(type, categoryName, null);
    }
    if (subcategoryName === null) {
      return { categoryKey: category.key, subcategoryKey: null };
    }
    let subcategory = this.all.get(childKey(category.key, subcategoryName));
    if (!subcategory) {
      if (this.fixed) {
        return `"${category.name}" has no subcategory named "${subcategoryName}" in the Categories table`;
      }
      subcategory = this.open(type, subcategoryName, category);
    }
    return { categoryKey: category.key, subcategoryKey: subcategory.key };
  }

  private subcategoriesNamed(type: CategoryType, name: string): PlannedCategory[] {
    return [...this.all.values()].filter(
      (category) => category.type === type && category.parentKey !== null && normalizeName(category.name) === normalizeName(name),
    );
  }
}

function readCategories(table: TableRead, { categories, problems }: Context): void {
  const rows: { reader: RowReader<CategoryColumn>; category: Omit<PlannedCategory, 'key' | 'parentKey'>; parent: string | null }[] = [];
  eachRow(table, CATEGORIES, problems, (reader) => {
    const name = reader.required('name', readText);
    if (name !== null && name.length > MAX_NAME) {
      reader.problem(`Name is longer than ${MAX_NAME} characters`);
    }
    const type = reader.required('type', (cell) => readChoice(cell, CATEGORY_TYPES));
    const parent = reader.text('parent');
    const icon = reader.text('icon', MAX_ICON);
    const color = reader.color('color');
    const archived = reader.read('archived', readBoolean) ?? false;
    if (!reader.failed && name !== null && type !== null) {
      rows.push({ reader, category: { name, type, icon, color, archived }, parent });
    }
  });

  // Top-level categories first, so that a subcategory may come before its parent in the file.
  for (const { category } of rows.filter((row) => row.parent === null)) {
    categories.add({ ...category, key: topKey(category.type, category.name), parentKey: null });
  }
  for (const { reader, category, parent } of rows) {
    if (parent === null) {
      continue;
    }
    const parentKey = topKey(category.type, parent);
    if (!categories.get(parentKey)) {
      const nested = rows.some(
        (row) => row.parent !== null && row.category.type === category.type && normalizeName(row.category.name) === normalizeName(parent),
      );
      reader.problem(
        nested
          ? `Parent "${parent}" is a subcategory itself, and subcategories go one level deep`
          : `There's no top-level ${category.type} category named "${parent}" for its Parent`,
      );
      continue;
    }
    categories.add({ ...category, key: childKey(parentKey, category.name), parentKey });
  }
}

// ---------------------------------------------------------------------------------------------
// What transactions and series both carry

type MovementColumn =
  | 'type'
  | 'amount'
  | 'currency'
  | 'account'
  | 'category'
  | 'subcategory'
  | 'toAccount'
  | 'currencyReceived'
  | 'note'
  | 'percentage'
  | 'baseAmount'
  | 'roundBalanceTo';

interface MovementRead {
  movement: PlannedMovement;
  account: PlannedAccount;
  toAccount: PlannedAccount | null;
}

// A percentage of the balance, or a rounding of it: worked out from what the account holds on the
// day, so ahead of it an estimate, which may come to nothing for now.
function isFromBalance(movement: Pick<PlannedMovement, 'percentage' | 'percentageBase' | 'roundBalanceTo'>): boolean {
  return (movement.percentage !== null && movement.percentageBase === null) || movement.roundBalanceTo !== null;
}

function readMovement(row: RowReader<MovementColumn>, { accounts, categories, options }: Context): MovementRead | null {
  const type = row.required('type', (cell) => readChoice(cell, TRANSACTION_TYPES));
  const amount = row.required('amount', readAmount);
  const currency = row.currency('currency', options.currencies);
  const accountName = row.required('account', readText);
  const categoryName = row.text('category');
  const subcategoryName = row.text('subcategory');
  const toAccountName = row.text('toAccount');
  const currencyReceived = row.currency('currencyReceived', options.currencies);
  const note = row.read('note', readText);
  const percentage = row.read('percentage', readPercentage);
  const percentageBase = row.read('baseAmount', readAmount);
  const roundBalanceTo = row.read('roundBalanceTo', readInteger);

  if (percentageBase !== null) {
    if (percentage === null) {
      row.problem('Base amount goes with a Percentage');
    } else if (Number(percentageBase) === 0) {
      row.problem('Base amount must be greater than zero');
    }
  }
  if (roundBalanceTo !== null) {
    if (!isRoundBalanceStep(roundBalanceTo)) {
      row.problem('Round balance to is 1, 10, 100 or 1000');
    } else if (percentage !== null) {
      row.problem('An amount comes from a percentage or from rounding the balance, not both');
    }
  }
  if (type === 'transfer') {
    if (toAccountName === null) {
      row.problem('A transfer needs its To account');
    }
    if (categoryName !== null || subcategoryName !== null) {
      row.problem('A transfer has no category');
    }
  } else if (type !== null && toAccountName !== null) {
    row.problem('Only a transfer has a To account');
  }

  const account = accountName === null ? null : accounts.resolve(accountName, currency, 'Currency');
  if (typeof account === 'string') {
    row.problem(account);
  }
  const toAccount =
    type === 'transfer' && toAccountName !== null ? accounts.resolve(toAccountName, currencyReceived, 'Currency received') : null;
  if (typeof toAccount === 'string') {
    row.problem(toAccount);
  }
  const filed: CategoryPair | string =
    type === null || type === 'transfer' ? { categoryKey: null, subcategoryKey: null } : categories.resolve(type, categoryName, subcategoryName);
  if (typeof filed === 'string') {
    row.problem(filed);
  }

  if (
    row.failed ||
    type === null ||
    amount === null ||
    account === null ||
    typeof account === 'string' ||
    typeof toAccount === 'string' ||
    typeof filed === 'string'
  ) {
    return null;
  }
  return {
    account,
    toAccount,
    movement: {
      type,
      amount,
      accountKey: account.key,
      toAccountKey: toAccount?.key ?? null,
      ...filed,
      note,
      percentage,
      percentageBase,
      roundBalanceTo,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Series

interface SeriesRead {
  row: number;
  // The Next date the row gives, if any: when the series next produces a transaction.
  next: Date | null;
  series: PlannedSeries;
}

function readSeries(table: TableRead, context: Context): SeriesRead[] {
  const { options, problems } = context;
  const read: SeriesRead[] = [];
  let position = 0;
  eachRow(table, SERIES, problems, (row) => {
    position++;
    const number = row.read('series', readInteger) ?? position;
    const movement = readMovement(row, context);
    const unit = row.required('repeat', (cell) => readChoice(cell, RECURRENCE_UNITS));
    const every = row.read('every', readInteger) ?? 1;
    if (every < 1) {
      row.problem('Every is at least 1');
    }
    const timezone = row.read('timezone', readText) ?? options.timezone;
    const validZone = isValidTimezone(timezone);
    if (!validZone) {
      row.problem(`Time zone: "${timezone}" isn't a time zone like Europe/Kyiv`);
    }
    const zone = validZone ? timezone : options.timezone;
    const start = row.read('start', (cell) => readDateTime(cell, zone));
    const next = row.read('nextDate', (cell) => readDateTime(cell, zone));
    const startsAt = start ?? next;
    if (startsAt === null && !row.failed) {
      row.problem('Start is empty');
    }
    const active = row.read('active', readBoolean) ?? true;
    const reminderDaysBefore = row.read('remindDaysBefore', readInteger);

    if (movement && Number(movement.movement.amount) === 0 && !isFromBalance(movement.movement)) {
      row.problem('Amount must be greater than zero');
    }
    const earlier = read.find((other) => other.series.number === number);
    if (earlier) {
      row.problem(`row ${earlier.row} is series ${number} too`);
    }
    if (row.failed || !movement || unit === null || startsAt === null) {
      return;
    }
    read.push({
      row: row.number,
      next,
      series: {
        ...movement.movement,
        number,
        intervalUnit: unit,
        intervalValue: every,
        startsAt,
        // Settled once the transactions are read (see planSeries).
        nextRunDate: startsAt,
        timezone: zone,
        active,
        reminderDaysBefore,
        crossCurrency: movement.toAccount !== null && movement.toAccount.currency !== movement.account.currency,
      },
    });
  });
  return read;
}

// ---------------------------------------------------------------------------------------------
// Transactions

interface TransactionRead {
  row: number;
  transaction: PlannedTransaction;
  // The series the row marks as having planned it.
  series: number | null;
}

function readTransactions(table: TableRead, series: SeriesRead[], hasSeriesTable: boolean, context: Context): TransactionRead[] {
  const { options, problems } = context;
  const read: TransactionRead[] = [];
  eachRow(table, TRANSACTIONS, problems, (row) => {
    const date = row.required('date', (cell) => readDateTime(cell, options.timezone));
    const movement = readMovement(row, context);
    const received = row.read('amountReceived', readAmount);
    const tags = (row.read('tags', readText) ?? '')
      .split(',')
      .map((tag) => tag.normalize('NFC').trim())
      .filter(Boolean);
    for (const tag of tags) {
      if (tag.length > MAX_TAG) {
        row.problem(`Tags: "${tag}" is longer than ${MAX_TAG} characters`);
      }
    }
    const seriesNumber = row.read('series', readInteger);
    if (seriesNumber !== null && !series.some((other) => other.series.number === seriesNumber)) {
      row.problem(hasSeriesTable ? `There's no series ${seriesNumber} in the Series table` : `Series ${seriesNumber} needs a Series table`);
    }
    if (!movement || date === null || row.failed) {
      return;
    }

    const { account, toAccount } = movement;
    // Nothing, only for an amount from the balance that's still to be worked out on its day.
    if (Number(movement.movement.amount) === 0 && !(isFromBalance(movement.movement) && date.getTime() > options.now.getTime())) {
      row.problem('Amount must be greater than zero');
      return;
    }
    let destAmount: string | null = null;
    if (received !== null) {
      if (toAccount === null) {
        row.problem('Only a transfer has an Amount received');
        return;
      }
      if (toAccount.currency !== account.currency) {
        if (Number(received) === 0) {
          row.problem('Amount received must be greater than zero');
          return;
        }
        destAmount = received;
      } else if (Number(received) !== Number(movement.movement.amount)) {
        row.problem('Amount received differs from Amount, and both accounts are in the same currency');
        return;
      }
    }

    read.push({
      row: row.number,
      series: seriesNumber,
      transaction: { ...movement.movement, date, destAmount, tags: [...new Set(tags)], occurrence: null },
    });
  });
  return read;
}

// ---------------------------------------------------------------------------------------------
// How each series carries on

// The series' first date after `date`.
function firstDateAfter(series: PlannedSeries, date: Date): Date {
  const schedule: Schedule = {
    startsAt: series.startsAt,
    intervalUnit: series.intervalUnit,
    intervalValue: series.intervalValue,
    timezone: series.timezone,
  };
  return occurrenceAt(schedule, firstIndexAtOrAfter(schedule, new Date(date.getTime() + 1)));
}

/**
 * Where each series carries on from, and which transaction it has planned.
 *
 * A running series keeps one transaction planned, and the file marks it with the series' number,
 * scheduled for the series' Next date. Still ahead, that transaction goes on as the series' own:
 * changes to the series later reach it too, unless it was changed by hand — told by comparing it
 * with what the series writes. Either way the series carries on with its date after that one.
 *
 * Without a marked transaction a series starts from its Next date, or from its Start — which, in
 * the past, records every date from then until today, as the app does for a series set up that way.
 */
function planSeries(series: SeriesRead[], transactions: TransactionRead[], { options, problems }: Context): void {
  const marked = new Map<number, TransactionRead[]>();
  for (const read of transactions) {
    if (read.series === null) {
      continue;
    }
    const owner = series.find((candidate) => candidate.series.number === read.series)?.series;
    if (owner && owner.type !== read.transaction.type) {
      problems.add(`Transactions, row ${read.row}: series ${read.series} repeats a ${owner.type}, and this is a ${read.transaction.type}`);
      continue;
    }
    marked.set(read.series, [...(marked.get(read.series) ?? []), read]);
  }

  for (const { series: planned, next } of series) {
    const rows = marked.get(planned.number) ?? [];
    if (rows.length > 1) {
      problems.add(
        `Transactions, rows ${rows.map((read) => read.row).join(', ')}: all marked as series ${planned.number}, which plans one transaction at a time`,
      );
      continue;
    }
    if (rows.length === 0) {
      planned.nextRunDate = next ?? planned.startsAt;
      continue;
    }
    const { transaction } = rows[0];
    const scheduled = next ?? transaction.date;
    if (planned.active && transaction.date.getTime() > options.now.getTime()) {
      transaction.occurrence = {
        series: planned.number,
        recurrenceDate: scheduled,
        customized: transaction.date.getTime() !== scheduled.getTime() || differsFromSeries(transaction, planned),
      };
    }
    planned.nextRunDate = firstDateAfter(planned, scheduled);
  }
}

/** Whether a planned transaction is other than what its series writes: someone changed it. */
function differsFromSeries(transaction: PlannedTransaction, series: PlannedSeries): boolean {
  const same = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Number(a) === Number(b));
  if (
    transaction.accountKey !== series.accountKey ||
    transaction.toAccountKey !== series.toAccountKey ||
    transaction.categoryKey !== series.categoryKey ||
    transaction.subcategoryKey !== series.subcategoryKey ||
    (transaction.note ?? '') !== (series.note ?? '') ||
    transaction.tags.length > 0 ||
    // A series converts at the rate; a figure given is someone's own.
    transaction.destAmount !== null ||
    transaction.roundBalanceTo !== series.roundBalanceTo ||
    !same(transaction.percentage, series.percentage) ||
    !same(transaction.percentageBase, series.percentageBase)
  ) {
    return true;
  }
  // A worked-out amount is whatever it comes to; only a fixed one is the series' own.
  return series.percentage === null && series.roundBalanceTo === null && !same(transaction.amount, series.amount);
}

/**
 * An account's Balance is what it held when the file was written, which its transactions make up
 * again when they come along. An account none of them touch — one listed with the balance it's to
 * start from — opens with it instead.
 */
function planOpeningBalances(accounts: PlannedAccount[], transactions: TransactionRead[]): void {
  const touched = new Set<string>();
  for (const { transaction } of transactions) {
    touched.add(transaction.accountKey);
    if (transaction.toAccountKey) {
      touched.add(transaction.toAccountKey);
    }
  }
  for (const account of accounts) {
    if (account.openingBalance !== null && (touched.has(account.key) || Number(account.openingBalance) === 0)) {
      account.openingBalance = null;
    }
  }
}
