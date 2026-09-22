import { exportTables } from './export-tables';
import { ACCOUNTS, CATEGORIES, SERIES, TRANSACTIONS, type TableSpec } from './tables';
import { NOW, sampleSnapshot } from './testing/sample-group';

function column<K extends string>(spec: TableSpec<K>, key: K): number {
  return spec.columns.findIndex((candidate) => candidate.key === key);
}

describe('exportTables', () => {
  const [transactions, accounts, categories, series] = exportTables(sampleSnapshot(), { timezone: 'UTC', now: NOW });

  it('writes the tables in the order a workbook holds them', () => {
    expect([transactions, accounts, categories, series].map(({ spec }) => spec)).toEqual([TRANSACTIONS, ACCOUNTS, CATEGORIES, SERIES]);
  });

  it('numbers the second of two accounts that would read as one', () => {
    const names = accounts.rows.map((row) => [row[column(ACCOUNTS, 'name')], row[column(ACCOUNTS, 'currency')]]);
    expect(names).toEqual([
      ['Cash', 'UAH'],
      ['Card', 'UAH'],
      ['Card', 'USD'],
      ['cash (2)', 'UAH'],
    ]);
    // And refers to it by that name.
    const moved = transactions.rows[5];
    expect(moved[column(TRANSACTIONS, 'account')]).toBe('cash (2)');
    expect(moved[column(TRANSACTIONS, 'toAccount')]).toBe('Cash');
  });

  it('files a subcategory beside its category, and a transfer under nothing', () => {
    const groceries = transactions.rows[1];
    expect(groceries[column(TRANSACTIONS, 'category')]).toBe('Food');
    expect(groceries[column(TRANSACTIONS, 'subcategory')]).toBe('Groceries');
    expect(groceries[column(TRANSACTIONS, 'tags')]).toBe('home, weekly');
    expect(categories.rows.map((row) => row[column(CATEGORIES, 'parent')])).toEqual([null, 'Food', null, null]);
  });

  it('leaves a received amount out while it’s still an estimate', () => {
    expect(transactions.rows[2][column(TRANSACTIONS, 'amountReceived')]).toBe('100.00');
    expect(transactions.rows[2][column(TRANSACTIONS, 'currencyReceived')]).toBe('USD');
    expect(transactions.rows[4][column(TRANSACTIONS, 'amountReceived')]).toBeNull();
  });

  it('marks only the transaction a series has planned with its number', () => {
    expect(transactions.rows.map((row) => row[column(TRANSACTIONS, 'series')])).toEqual([null, null, null, '1', null, null]);
  });

  it('writes a series’ dates in its own zone', () => {
    const [rent] = series.rows;
    expect(rent[column(SERIES, 'series')]).toBe('1');
    // Local times, held as a spreadsheet holds them: midnight on the 1st.
    expect(rent[column(SERIES, 'start')]).toEqual(new Date('2026-02-01T00:00:00Z'));
    expect(rent[column(SERIES, 'nextDate')]).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(rent[column(SERIES, 'timezone')]).toBe('Asia/Tokyo');
  });
});
