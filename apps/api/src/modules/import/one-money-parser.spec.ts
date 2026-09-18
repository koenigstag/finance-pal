import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { OneMoneyFormatError, parseOneMoneyBackup } from './one-money-parser';

const UAH = 10057;
const USD = 10051;

let directory: string;

function backupFile(build: (db: DatabaseSync) => void): string {
  const path = join(directory, `${Math.random().toString(36).slice(2)}.sqlite`);
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE ba (_id INTEGER, _na TEXT, _da INTEGER, _ty INTEGER)');
  db.exec(
    'CREATE TABLE de (_id INTEGER, _b_i INTEGER, _ty INTEGER, _c_i INTEGER, _ic INTEGER, _co INTEGER, _na TEXT, _de TEXT, _ar INTEGER, _a_m_b TEXT, _a_i_i_b INTEGER, _a_o INTEGER, _pi INTEGER)',
  );
  db.exec(
    'CREATE TABLE tr (_id INTEGER, _b_i INTEGER, _ty INTEGER, _da INTEGER, _sch INTEGER, _a_i INTEGER, _d_i INTEGER, _a_m TEXT, _d_m TEXT, _co TEXT, _rec INTEGER)',
  );
  db.exec('CREATE TABLE bu (_id INTEGER, _b_i INTEGER, _or INTEGER, _mo TEXT)');
  build(db);
  db.close();
  return path;
}

// The parent comes last, as in 1Money's own table; only a subcategory has one.
const entity = (db: DatabaseSync, values: (string | number | null)[], parent: number | null = null) =>
  db.prepare('INSERT INTO de VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...values, parent);
// How often it repeats comes last: 0 for a one-off, a code for a scheduled series, 100 plus its
// number for an occurrence 1Money recorded from one.
const transaction = (db: DatabaseSync, values: (string | number | null)[], recurrence = 0) =>
  db.prepare('INSERT INTO tr VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...values, recurrence);

// One older snapshot and one current, as a real backup carries.
function sampleBackup(): string {
  return backupFile((db) => {
    db.prepare('INSERT INTO ba VALUES (?, ?, ?, ?)').run(1, 'Daily backup', 1000, 4);
    db.prepare('INSERT INTO ba VALUES (?, ?, ?, ?)').run(2, 'Export', 2000, 2);
    // Stale snapshot: an account that no longer exists, which must not be imported.
    entity(db, [10, 1, 0, UAH, 1, -1, 'Old wallet', null, 0, '5', 1, 0]);
    // id, book, type, currency, icon, colour, name, description, archived, opening, inBalance, order
    entity(db, [100, 2, 0, UAH, 1, -14244198, 'Наличные', 'Расходные', 0, '3000', 1, 0]);
    entity(db, [101, 2, 2, USD, 2, -1092784, 'Payoneer', '', 0, '1860.02', 1, 1]);
    entity(db, [102, 2, 1, UAH, 3, null, 'Валера', '', 0, null, 0, 2]);
    entity(db, [103, 2, 0, UAH, 4, null, 'Ощад', '', 1, null, 1, -1]);
    entity(db, [104, 2, 0, 19999, 5, null, 'Neznakomaya', '', 0, null, 1, 3]);
    entity(db, [110, 2, 1, UAH, 81, -21696, 'Продукты', null, 0, null, null, null]);
    entity(db, [111, 2, 0, UAH, 7, null, 'Зарплата', null, 0, null, null, null]);
    entity(db, [112, 2, 4, UAH, 8, null, 'Все счета', null, 0, null, 1, 9]);
    // Категории carry their position here, not in `de`; 113 has none and goes last.
    entity(db, [113, 2, 1, UAH, 9, null, 'Кафе', null, 0, null, null, null]);
    db.prepare('INSERT INTO bu VALUES (?, ?, ?, ?)').run(110, 2, 1, null);
    db.prepare('INSERT INTO bu VALUES (?, ?, ?, ?)').run(111, 2, 0, null);
    // type, date, scheduled, from, to, amount, dest amount, note
    transaction(db, [200, 2, 1, 1_700_000_000_000, 0, 100, 111, '500', '500', null]);
    transaction(db, [201, 2, 0, 1_700_000_100_000, 0, 100, 110, '120.5', '120.5', 'хлеб']);
    // Lending: labelled an expense, but its target is an account, so it's a transfer.
    transaction(db, [202, 2, 0, 1_700_000_200_000, 0, 100, 102, '300', '300', null]);
    // Cross-currency transfer.
    transaction(db, [203, 2, 2, 1_700_000_300_000, 0, 101, 100, '10', '420', null]);
    // Scheduled, and a row with no amount, which has nothing to import.
    transaction(db, [204, 2, 0, 1_900_000_000_000, 1, 101, 110, '7', '7', 'Termius']);
    transaction(db, [205, 2, 0, 1_700_000_400_000, 0, 100, 110, null, null, null]);
  });
}

// Subcategories as 1Money writes them: the parent's id in `_pi`, and positions that carry on
// from the top-level ones instead of starting again under each parent. Налоги was added after
// them, so a top-level number can be the higher one.
function backupWithSubcategories(): string {
  return backupFile((db) => {
    db.prepare('INSERT INTO ba VALUES (?, ?, ?, ?)').run(1, 'Export', 1000, 2);
    entity(db, [100, 1, 0, UAH, 1, null, 'Наличные', null, 0, null, 1, 0]);
    entity(db, [110, 1, 1, UAH, 14, null, 'Продукты', null, 0, null, null, null]);
    entity(db, [111, 1, 1, UAH, 17, null, 'Транспорт', null, 0, null, null, null]);
    entity(db, [112, 1, 1, UAH, 30, null, 'Налоги', null, 0, null, null, null]);
    entity(db, [120, 1, 1, UAH, 119, null, 'Сильпо', null, 0, null, null, null], 110);
    entity(db, [121, 1, 1, UAH, 14, null, 'АТБ', null, 0, null, null, null], 110);
    entity(db, [122, 1, 1, UAH, 17, null, 'Маршрутка', null, 0, null, null, null], 111);
    for (const [id, order] of [[110, 0], [111, 1], [121, 2], [120, 3], [122, 4], [112, 5]]) {
      db.prepare('INSERT INTO bu VALUES (?, ?, ?, ?)').run(id, 1, order, null);
    }
    transaction(db, [200, 1, 0, 1_700_000_000_000, 0, 100, 121, '85', '85', null]);
  });
}

// A monthly series with two occurrences recorded so far, and scheduled entries repeating in ways
// that do and don't carry over.
function backupWithSeries(): string {
  return backupFile((db) => {
    db.prepare('INSERT INTO ba VALUES (?, ?, ?, ?)').run(1, 'Export', 1000, 2);
    entity(db, [100, 1, 0, UAH, 1, null, 'Наличные', null, 0, null, 1, 0]);
    entity(db, [110, 1, 1, UAH, 14, null, 'Аренда', null, 0, null, null, null]);
    // type, date, scheduled, from, to, amount, dest amount, note
    transaction(db, [200, 1, 0, 1_700_000_000_000, 0, 100, 110, '9000', '9000', null], 101);
    transaction(db, [201, 1, 0, 1_702_600_000_000, 0, 100, 110, '9000', '9000', null], 102);
    // The series itself, at its next due date: every month.
    transaction(db, [202, 1, 0, 1_905_000_000_000, 1, 100, 110, '9000', '9000', 'Квартира'], 8);
    // Every 4 weeks, and every 6 months.
    transaction(db, [203, 1, 0, 1_905_100_000_000, 1, 100, 110, '100', '100', null], 7);
    transaction(db, [204, 1, 0, 1_905_200_000_000, 1, 100, 110, '200', '200', null], 11);
    // Weekdays only, which a series here can't express, and a one-off.
    transaction(db, [205, 1, 0, 1_905_300_000_000, 1, 100, 110, '300', '300', null], 3);
    transaction(db, [206, 1, 0, 1_905_400_000_000, 1, 100, 110, '400', '400', null], 0);
    // A code this importer doesn't know.
    transaction(db, [207, 1, 0, 1_905_500_000_000, 1, 100, 110, '500', '500', null], 13);
  });
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'one-money-spec-'));
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('parseOneMoneyBackup', () => {
  it('reads accounts from the newest snapshot only, with their type and opening balance', () => {
    const { accounts } = parseOneMoneyBackup(sampleBackup());

    expect(accounts.map((account) => account.name)).toEqual(['Ощад', 'Наличные', 'Payoneer', 'Валера']);
    expect(accounts.find((account) => account.name === 'Наличные')).toMatchObject({
      type: 'regular',
      currencyCode: 'UAH',
      // `_ic` 1 is the three dots 1Money puts on "Other".
      icon: 'dots-horizontal',
      openingBalance: '3000.00',
      description: 'Расходные',
      isIncludedInBalance: true,
      archived: false,
      color: '#26A69A',
    });
    expect(accounts.find((account) => account.name === 'Payoneer')).toMatchObject({
      type: 'savings',
      currencyCode: 'USD',
      openingBalance: '1860.02',
    });
    expect(accounts.find((account) => account.name === 'Валера')).toMatchObject({
      type: 'debt',
      openingBalance: '0',
      isIncludedInBalance: false,
    });
    expect(accounts.find((account) => account.name === 'Ощад')?.archived).toBe(true);
  });

  it('separates categories from accounts and types them', () => {
    const { categories } = parseOneMoneyBackup(sampleBackup());

    // In the order the app had them, with the one it never placed last.
    expect(categories).toEqual([
      { sourceId: 111, name: 'Зарплата', type: 'income', icon: null, color: null, archived: false, sortOrder: 0, parentSourceId: null },
      { sourceId: 110, name: 'Продукты', type: 'expense', icon: 'wrench', color: '#FFAB40', archived: false, sortOrder: 1, parentSourceId: null },
      { sourceId: 113, name: 'Кафе', type: 'expense', icon: null, color: null, archived: false, sortOrder: 9999, parentSourceId: null },
    ]);
  });

  it('nests subcategories under their parent, listing every top-level category first', () => {
    const { categories } = parseOneMoneyBackup(backupWithSubcategories());

    expect(categories.map((category) => [category.name, category.parentSourceId])).toEqual([
      ['Продукты', null],
      ['Транспорт', null],
      // Numbered 5, above every subcategory, and still listed before them, as all top-level ones are.
      ['Налоги', null],
      // Among siblings, the app's order: АТБ was placed above Сильпо.
      ['АТБ', 110],
      ['Сильпо', 110],
      ['Маршрутка', 111],
    ]);
  });

  it('files a transaction in a subcategory under its parent, with the subcategory beside it', () => {
    const { transactions } = parseOneMoneyBackup(backupWithSubcategories());

    // 1Money points it at АТБ alone; the parent comes from the category tree.
    expect(transactions).toEqual([
      expect.objectContaining({ type: 'expense', amount: '85.00', categorySourceId: 110, subcategorySourceId: 121 }),
    ]);
  });

  it('puts a subcategory the app could not nest at the top level instead', () => {
    const path = backupFile((db) => {
      db.prepare('INSERT INTO ba VALUES (?, ?, ?, ?)').run(1, 'Export', 1000, 2);
      entity(db, [100, 1, 0, UAH, 1, null, 'Наличные', null, 0, null, 1, 0]);
      entity(db, [110, 1, 1, UAH, null, null, 'Продукты', null, 0, null, null, null]);
      entity(db, [120, 1, 1, UAH, null, null, 'Сильпо', null, 0, null, null, null], 110);
      // Income under an expense category, a third level, and a parent the file doesn't have.
      entity(db, [121, 1, 0, UAH, null, null, 'Кешбэк', null, 0, null, null, null], 110);
      entity(db, [122, 1, 1, UAH, null, null, 'Акции', null, 0, null, null, null], 120);
      entity(db, [123, 1, 1, UAH, null, null, 'Рынок', null, 0, null, null, null], 999);
      transaction(db, [200, 1, 0, 1_700_000_000_000, 0, 100, 123, '40', '40', null]);
    });
    const { categories, transactions } = parseOneMoneyBackup(path);

    expect(Object.fromEntries(categories.map((category) => [category.name, category.parentSourceId]))).toEqual({
      Продукты: null,
      Сильпо: 110,
      Кешбэк: null,
      Акции: null,
      Рынок: null,
    });
    // Its transactions go with it: filed under it as a category of its own.
    expect(transactions[0]).toMatchObject({ categorySourceId: 123, subcategorySourceId: null });
  });

  it('reads a file without the parent column as having no subcategories', () => {
    const path = backupWithSubcategories();
    const db = new DatabaseSync(path);
    db.exec('ALTER TABLE de DROP COLUMN _pi');
    db.close();

    const { categories } = parseOneMoneyBackup(path);

    expect(categories).toHaveLength(6);
    expect(categories.every((category) => category.parentSourceId === null)).toBe(true);
  });

  it('reads a transfer from what the target is, not from the label', () => {
    const { transactions } = parseOneMoneyBackup(sampleBackup());

    expect(transactions.map((item) => [item.type, item.amount])).toEqual([
      ['income', '500.00'],
      ['expense', '120.50'],
      // Labelled an expense by 1Money, but the money went to another account.
      ['transfer', '300.00'],
      ['transfer', '10.00'],
      ['expense', '7.00'],
    ]);
    expect(transactions[2]).toMatchObject({ toAccountSourceId: 102, categorySourceId: null, destAmount: null });
    // Different currencies on each side, so what arrived is kept.
    expect(transactions[3]).toMatchObject({ toAccountSourceId: 100, destAmount: '420.00' });
    expect(transactions[1]).toMatchObject({ categorySourceId: 110, note: 'хлеб' });
    expect(transactions[4].scheduled).toBe(true);
  });

  it('reads how a scheduled entry repeats, when a series here can repeat that way', () => {
    const { transactions } = parseOneMoneyBackup(backupWithSeries());

    expect(transactions.map((item) => [item.amount, item.scheduled, item.recurrence])).toEqual([
      // Occurrences 1Money already recorded are ordinary transactions.
      ['9000.00', false, null],
      ['9000.00', false, null],
      ['9000.00', true, { unit: 'month', value: 1 }],
      ['100.00', true, { unit: 'week', value: 4 }],
      ['200.00', true, { unit: 'month', value: 6 }],
      ['300.00', true, null],
      ['400.00', true, null],
      ['500.00', true, null],
    ]);
  });

  it('reads a file without the repeat column as having no series', () => {
    const path = backupWithSeries();
    const db = new DatabaseSync(path);
    db.exec('ALTER TABLE tr DROP COLUMN _rec');
    db.close();

    const { transactions } = parseOneMoneyBackup(path);

    expect(transactions.every((item) => item.recurrence === null)).toBe(true);
  });

  it('reports currencies it has no code for instead of guessing', () => {
    const { accounts, unknownCurrencies } = parseOneMoneyBackup(sampleBackup());

    expect(accounts.map((account) => account.name)).not.toContain('Neznakomaya');
    expect(unknownCurrencies).toEqual([{ currencyId: 19999, accounts: ['Neznakomaya'] }]);
  });

  it("takes the caller's mapping for a currency it doesn't know", () => {
    const { accounts, unknownCurrencies } = parseOneMoneyBackup(sampleBackup(), { 19999: 'PLN' });

    expect(unknownCurrencies).toEqual([]);
    expect(accounts.find((account) => account.name === 'Neznakomaya')?.currencyCode).toBe('PLN');
  });

  it('refuses a file that is not a 1Money backup', () => {
    const path = backupFile((db) => db.exec('CREATE TABLE something_else (id INTEGER)'));
    // The tables it needs are created by backupFile, so drop them to make it a stranger.
    const db = new DatabaseSync(path);
    db.exec('DROP TABLE de');
    db.close();

    expect(() => parseOneMoneyBackup(path)).toThrow(OneMoneyFormatError);
  });
});
