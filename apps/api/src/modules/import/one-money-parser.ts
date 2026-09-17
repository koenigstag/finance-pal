import { DatabaseSync } from 'node:sqlite';
import { AccountType, CategoryType, TransactionType } from '@ft/api-database';

/**
 * Reads a 1Money Android backup (a SQLite file) into plain data, ready to be written as a group.
 *
 * The schema uses two-letter names and no foreign keys, so what follows is what each one holds,
 * worked out from a real backup and checked against the app's own CSV export — every account's
 * balance comes out to the cent:
 *
 *   ba  one row per snapshot the file carries (daily backups plus manual exports). Everything
 *       else is stored once per snapshot and keyed by `_b_i`, so only the newest is of interest.
 *   de  accounts *and* categories together. A row with `_a_o` (a sort order) is an account;
 *       anything else is a category. `_ty` then means account type (0 regular, 1 debt, 2 savings)
 *       or category type (0 income, 1 expense). `_a_m_b` is the account's opening balance,
 *       `_a_i_i_b` whether it counts toward the total, `_ar` archived, `_co` an ARGB colour and
 *       `_c_i` the currency. `_ty` 4 is the pseudo-account "all accounts", which isn't one.
 *   bu  one row per entity holding `_or`, the position the user dragged it to. Accounts carry
 *       their own order in `de._a_o`; for categories this is the only place it exists, numbered
 *       from zero within each type.
 *   tr  transactions. `_ty` is 0 expense, 1 income, 2 transfer, but it can't be trusted on its
 *       own: 1Money writes lending to a debt account as an expense whose target is that account.
 *       What the target *is* decides. `_da` is epoch milliseconds, `_a_m`/`_d_m` the amounts on
 *       each side, `_co` the note, `_sch` marks a scheduled (future) entry and `_ta` tags, which
 *       this importer ignores because the export never fills them in.
 */

// 1Money's internal currency ids. Only the ones seen in the wild are known; anything else has to
// be supplied by the caller, rather than guessed and silently recorded in the wrong currency.
const KNOWN_CURRENCY_IDS: Record<number, string> = {
  10002: 'EUR',
  10051: 'USD',
  10057: 'UAH',
};

const PSEUDO_ACCOUNT_TYPE = 4;

// Where a category with no recorded position ends up: after every category that has one.
const UNORDERED = 9999;

const ACCOUNT_TYPES: Record<number, AccountType> = {
  0: AccountType.REGULAR,
  1: AccountType.DEBT,
  2: AccountType.SAVINGS,
};

export interface ParsedAccount {
  sourceId: number;
  name: string;
  description: string | null;
  type: AccountType;
  currencyCode: string;
  // What the account held before the first transaction in the file; '0' when it started empty.
  openingBalance: string;
  isIncludedInBalance: boolean;
  archived: boolean;
  sortOrder: number;
  color: string | null;
}

export interface ParsedCategory {
  sourceId: number;
  name: string;
  type: CategoryType;
  color: string | null;
  archived: boolean;
  // Where it sits in its type's list, as arranged in the app.
  sortOrder: number;
}

export interface ParsedTransaction {
  type: TransactionType;
  date: Date;
  amount: string;
  // Only for a transfer between accounts in different currencies: what arrived.
  destAmount: string | null;
  accountSourceId: number;
  toAccountSourceId: number | null;
  categorySourceId: number | null;
  note: string | null;
  // 1Money's scheduled entries: future-dated, so they arrive as planned transactions.
  scheduled: boolean;
}

export interface ParsedBackup {
  accounts: ParsedAccount[];
  categories: ParsedCategory[];
  // Oldest first, so balances build up in the order they happened.
  transactions: ParsedTransaction[];
  // Currency ids the file uses that this importer has no code for, with the accounts affected.
  unknownCurrencies: { currencyId: number; accounts: string[] }[];
}

export class OneMoneyFormatError extends Error {}

interface EntityRow {
  _id: number;
  _ty: number;
  _c_i: number | null;
  _ic: number | null;
  _co: number | null;
  _na: string | null;
  _de: string | null;
  _ar: number | null;
  _a_m_b: string | null;
  _a_i_i_b: number | null;
  _a_o: number | null;
}

interface TransactionRow {
  _ty: number;
  _da: number;
  _a_i: number;
  _d_i: number | null;
  _a_m: string | null;
  _d_m: string | null;
  _co: string | null;
  _sch: number | null;
}

/**
 * @param filePath the backup file, opened read-only.
 * @param currencyOverrides extra 1Money currency id → ISO code mappings from the caller.
 */
export function parseOneMoneyBackup(filePath: string, currencyOverrides: Record<number, string> = {}): ParsedBackup {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    assertOneMoneyBackup(db);
    const snapshotId = newestSnapshotId(db);
    const currencies = { ...KNOWN_CURRENCY_IDS, ...currencyOverrides };

    const entities = db.prepare('SELECT * FROM de WHERE _b_i = ?').all(snapshotId) as unknown as EntityRow[];
    const order = categoryOrder(db, snapshotId);
    const accounts: ParsedAccount[] = [];
    const categories: ParsedCategory[] = [];
    const unknown = new Map<number, string[]>();

    for (const row of entities) {
      const name = row._na?.trim();
      if (!name || row._ty === PSEUDO_ACCOUNT_TYPE) {
        continue;
      }
      if (row._a_o === null) {
        categories.push({
          sourceId: row._id,
          name,
          type: row._ty === 0 ? CategoryType.INCOME : CategoryType.EXPENSE,
          color: toHexColor(row._co),
          archived: row._ar === 1,
          // Anything the app never gave a place goes last rather than first.
          sortOrder: order.get(row._id) ?? UNORDERED,
        });
        continue;
      }
      const currencyCode = row._c_i === null ? undefined : currencies[row._c_i];
      if (!currencyCode) {
        const key = row._c_i ?? -1;
        unknown.set(key, [...(unknown.get(key) ?? []), name]);
        continue;
      }
      accounts.push({
        sourceId: row._id,
        name,
        description: row._de?.trim() || null,
        type: ACCOUNT_TYPES[row._ty] ?? AccountType.REGULAR,
        currencyCode,
        openingBalance: toAmount(row._a_m_b) ?? '0',
        isIncludedInBalance: row._a_i_i_b === 1,
        archived: row._ar === 1,
        sortOrder: row._a_o,
        color: toHexColor(row._co),
      });
    }

    const accountIds = new Set(accounts.map((account) => account.sourceId));
    const categoryIds = new Set(categories.map((category) => category.sourceId));
    const rows = db
      .prepare('SELECT * FROM tr WHERE _b_i = ? ORDER BY _da')
      .all(snapshotId) as unknown as TransactionRow[];

    const transactions: ParsedTransaction[] = [];
    for (const row of rows) {
      const amount = toAmount(row._a_m);
      // Rows whose account was dropped from the snapshot, or that carry no amount, have nothing
      // to import: leaving them out keeps the remaining balances right.
      if (!amount || !accountIds.has(row._a_i)) {
        continue;
      }
      const toAccount = row._d_i !== null && accountIds.has(row._d_i) ? row._d_i : null;
      const category = row._d_i !== null && categoryIds.has(row._d_i) ? row._d_i : null;
      const type = toAccount !== null ? TransactionType.TRANSFER : row._ty === 1 ? TransactionType.INCOME : TransactionType.EXPENSE;
      const destAmount = toAccount !== null ? toAmount(row._d_m) : null;
      transactions.push({
        type,
        date: new Date(row._da),
        amount,
        // Same amount on both sides means no conversion took place; recording it again would
        // only claim a rate that isn't there.
        destAmount: destAmount && destAmount !== amount ? destAmount : null,
        accountSourceId: row._a_i,
        toAccountSourceId: toAccount,
        categorySourceId: type === TransactionType.TRANSFER ? null : category,
        note: row._co?.trim() || null,
        scheduled: row._sch === 1,
      });
    }

    return {
      accounts: accounts.sort((a, b) => a.sortOrder - b.sortOrder),
      categories: categories.sort((a, b) => a.sortOrder - b.sortOrder),
      transactions,
      unknownCurrencies: [...unknown].map(([currencyId, names]) => ({ currencyId, accounts: names })),
    };
  } finally {
    db.close();
  }
}

// Positions from `bu`, which older backups may not carry; without it, categories keep the order
// the file lists them in.
function categoryOrder(db: DatabaseSync, snapshotId: number): Map<number, number> {
  if (!tableNames(db).has('bu')) {
    return new Map();
  }
  const rows = db.prepare('SELECT _id, _or FROM bu WHERE _b_i = ?').all(snapshotId) as unknown as {
    _id: number;
    _or: number | null;
  }[];
  return new Map(rows.filter((row) => row._or !== null).map((row) => [row._id, row._or as number]));
}

function assertOneMoneyBackup(db: DatabaseSync): void {
  const tables = tableNames(db);
  for (const table of ['ba', 'de', 'tr']) {
    if (!tables.has(table)) {
      throw new OneMoneyFormatError(`Not a 1Money backup: table "${table}" is missing`);
    }
  }
}

function tableNames(db: DatabaseSync): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

// A backup file carries every snapshot 1Money ever wrote into it; the newest is the live data.
function newestSnapshotId(db: DatabaseSync): number {
  const row = db.prepare('SELECT _id FROM ba ORDER BY _da DESC, _id DESC LIMIT 1').get() as
    | { _id: number }
    | undefined;
  if (row === undefined) {
    throw new OneMoneyFormatError('Not a 1Money backup: it contains no snapshots');
  }
  return row._id;
}

// Money is kept as text on both sides; this only fixes the scale and drops zero and junk values.
function toAmount(raw: string | null): string | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value === 0) {
    return null;
  }
  return value.toFixed(2);
}

// 1Money stores colours as a signed 32-bit ARGB integer.
function toHexColor(raw: number | null): string | null {
  if (raw === null) {
    return null;
  }
  const rgb = (raw >>> 0) & 0xffffff;
  return `#${rgb.toString(16).padStart(6, '0').toUpperCase()}`;
}
