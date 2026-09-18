import { DatabaseSync } from 'node:sqlite';
import type { ACCOUNT_TYPES, CATEGORY_TYPES, TRANSACTION_TYPES } from '@ft/shared-contracts';

// The shared string unions rather than the database's enums: this file reads a file and nothing
// else, and api-database wants a configured environment the moment it is imported.
type AccountType = (typeof ACCOUNT_TYPES)[number];
type CategoryType = (typeof CATEGORY_TYPES)[number];
type TransactionType = (typeof TRANSACTION_TYPES)[number];

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
 *       `_pi` makes a category a subcategory: it holds the `_id` of the category it sits under,
 *       which is top-level and of the same type — 1Money nests one level deep, as this app does.
 *   bu  one row per entity holding `_or`, the position the user dragged it to. Accounts carry
 *       their own order in `de._a_o`; for categories this is the only place it exists, numbered
 *       from zero within each type. Subcategories carry on from where their type's top-level
 *       categories stop, so a subcategory's number only places it among its siblings.
 *   tr  transactions. `_ty` is 0 expense, 1 income, 2 transfer, but it can't be trusted on its
 *       own: 1Money writes lending to a debt account as an expense whose target is that account.
 *       What the target *is* decides. `_da` is epoch milliseconds, `_a_m`/`_d_m` the amounts on
 *       each side, `_co` the note, `_sch` marks a scheduled (future) entry and `_ta` tags, which
 *       this importer ignores because the export never fills them in. A transaction filed under
 *       a subcategory targets the subcategory itself; `_p_id` and `_c_id` stay empty.
 */

// 1Money's internal currency ids. Only the ones seen in the wild are known; anything else has to
// be supplied by the caller, rather than guessed and silently recorded in the wrong currency.
const KNOWN_CURRENCY_IDS: Record<number, string> = {
  10002: 'EUR',
  10051: 'USD',
  10057: 'UAH',
};

const PSEUDO_ACCOUNT_TYPE = 4;

/**
 * 1Money's icons by the number it stores, named in this app's own set.
 *
 * The number is the index of a drawable in the app itself (`icon_14` and so on), which says nothing
 * on its own. Each entry below was read from that drawable, and the comment says what the picture
 * is. Where this app has nothing like it, the nearest in meaning stands in — a burger becomes a
 * pizza, a washing machine becomes water — and a number not listed arrives without an icon rather
 * than a wrong one, which is easily set by hand afterwards. The app has some 400 of them; these are
 * the ones seen in real backups so far.
 */
const ICONS: Record<number, string> = {
  1: 'dots-horizontal', // three dots
  2: 'landmark', // a bank's columns
  4: 'card', // a payment card
  5: 'vault', // a safe
  8: 'coins', // a stack of coins
  12: 'piggy-bank', // a piggy bank
  14: 'shopping-basket', // a shopping basket
  15: 'utensils', // fork and knife
  16: 'ticket', // a ticket
  17: 'bus', // a bus
  19: 'smile', // a smiling face
  20: 'heart', // a heart held in two hands
  21: 'bag', // a handbag
  24: 'gift', // a wrapped gift
  26: 'trending-up', // a rising bar chart
  30: 'banknote', // banknotes
  31: 'circle-dollar-sign', // a dollar in a circle
  34: 'circle-euro', // a euro in a circle
  39: 'card', // two interlocking circles, as on a card
  40: 'card', // a card with a logo
  41: 'chart-candlestick', // stacked blocks of shares
  62: 'sofa', // a sofa
  68: 'building', // office buildings
  81: 'wrench', // a wrench
  82: 'globe', // a globe
  85: 'dumbbell', // a dumbbell
  106: 'phone', // a telephone handset
  110: 'washing-machine', // a washing machine
  119: 'shopping-cart', // a shopping trolley
  121: 'sandwich', // a burger
  125: 'bag', // a paper bag
  132: 'banknote', // a banknote with a coin
  137: 'percent', // a percentage badge
  253: 'hand-heart', // someone having a massage
  266: 'package', // a parcel
  285: 'hand-coins', // an open hand
  286: 'handshake', // two hands shaking
  290: 'hand-coins', // a hand holding out a card
  293: 'wallet', // a coin purse
  296: 'wallet', // a folded wallet
  298: 'trending-up', // a rising bar chart
  302: 'tags', // price tags
  308: 'inbox', // a page in a tray
  324: 'receipt', // a till receipt
  325: 'recycle', // arrows in a circle
  334: 'scissors', // comb and scissors
  370: 'battery-charging', // a battery charging
  373: 'octagon-alert', // a stop sign
  385: 'home', // a house
};

// Where a category with no recorded position ends up: after every category that has one.
const UNORDERED = 9999;

const ACCOUNT_TYPE_BY_CODE: Record<number, AccountType> = { 0: 'regular', 1: 'debt', 2: 'savings' };

export interface ParsedAccount {
  sourceId: number;
  name: string;
  icon: string | null;
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
  icon: string | null;
  type: CategoryType;
  color: string | null;
  archived: boolean;
  // Where it sits among its siblings, as arranged in the app.
  sortOrder: number;
  // The category it's a subcategory of: always a top-level category of the same type from the
  // same backup. A parent the app couldn't hold it under — missing from the file, of the other
  // type, or a subcategory itself — leaves this null, and the category stands on its own.
  parentSourceId: number | null;
}

export interface ParsedTransaction {
  type: TransactionType;
  date: Date;
  amount: string;
  // Only for a transfer between accounts in different currencies: what arrived.
  destAmount: string | null;
  accountSourceId: number;
  toAccountSourceId: number | null;
  // Always a top-level category: one filed under a subcategory names it here as its parent, and
  // the subcategory itself below.
  categorySourceId: number | null;
  subcategorySourceId: number | null;
  note: string | null;
  // 1Money's scheduled entries: future-dated, so they arrive as planned transactions.
  scheduled: boolean;
}

export interface ParsedBackup {
  accounts: ParsedAccount[];
  // Top-level categories first, then subcategories, so every parent is written before anything
  // that points at it.
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
  // Optional: a file without the column reads as having no subcategories.
  _pi?: number | null;
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
    // Each subcategory's parent as the file records it, to be checked once every category is known.
    const recordedParents = new Map<number, number>();
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
          type: row._ty === 0 ? 'income' : 'expense',
          icon: (row._ic !== null && ICONS[row._ic]) || null,
          color: toHexColor(row._co),
          archived: row._ar === 1,
          // Anything the app never gave a place goes last rather than first.
          sortOrder: order.get(row._id) ?? UNORDERED,
          // Settled below.
          parentSourceId: null,
        });
        const parentId = row._pi ?? null;
        if (parentId !== null) {
          recordedParents.set(row._id, parentId);
        }
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
        type: ACCOUNT_TYPE_BY_CODE[row._ty] ?? 'regular',
        icon: (row._ic !== null && ICONS[row._ic]) || null,
        currencyCode,
        openingBalance: toAmount(row._a_m_b) ?? '0',
        isIncludedInBalance: row._a_i_i_b === 1,
        archived: row._ar === 1,
        sortOrder: row._a_o,
        color: toHexColor(row._co),
      });
    }

    // Checked against what the file records rather than what's been settled so far, so the
    // outcome doesn't depend on the order the rows come in. A parent that doesn't qualify is
    // dropped: the category keeps its transactions and just sits at the top level.
    const categoryById = new Map(categories.map((category) => [category.sourceId, category]));
    for (const category of categories) {
      const parentId = recordedParents.get(category.sourceId);
      const parent = parentId === undefined ? undefined : categoryById.get(parentId);
      if (parent && parent.type === category.type && !recordedParents.has(parent.sourceId)) {
        category.parentSourceId = parent.sourceId;
      }
    }

    const accountIds = new Set(accounts.map((account) => account.sourceId));
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
      const type: TransactionType = toAccount !== null ? 'transfer' : row._ty === 1 ? 'income' : 'expense';
      const target = type === 'transfer' || row._d_i === null ? undefined : categoryById.get(row._d_i);
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
        categorySourceId: target ? (target.parentSourceId ?? target.sourceId) : null,
        subcategorySourceId: target && target.parentSourceId !== null ? target.sourceId : null,
        note: row._co?.trim() || null,
        scheduled: row._sch === 1,
      });
    }

    return {
      accounts: accounts.sort((a, b) => a.sortOrder - b.sortOrder),
      categories: categories.sort(
        (a, b) => Number(a.parentSourceId !== null) - Number(b.parentSourceId !== null) || a.sortOrder - b.sortOrder,
      ),
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
