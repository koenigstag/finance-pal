import { describe, expect, it } from 'vitest';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { buildOverview, foldRows, NEUTRAL_COLOR, sourceColor, type OverviewRow, type OverviewViewInput } from './overview-model';
import type { OverviewDays } from './queries';

const groupId = '11111111-1111-4111-8111-111111111111';
const UAH = 1;
const USD = 2;
const EUR = 3;

const category = (id: string, name: string, type: Category['type'], color: string | null = null): Category => ({
  id,
  groupId,
  parentId: null,
  type,
  name,
  icon: null,
  color,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const loan = {
  id: 'loan',
  groupId,
  type: 'debt',
  name: 'Loan',
  currencyId: UAH,
  isFavourite: false,
  icon: null,
  color: '#3366cc',
  description: null,
  isIncludedInBalance: true,
  notificationBank: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  balance: '0.00',
  plannedBalance: '0.00',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies Account;
const categories = [
  category('groceries', 'Groceries', 'expense', '#22aa55'),
  category('cafe', 'Cafe', 'expense'),
  category('salary', 'Salary', 'income'),
];

const entry = (
  day: string,
  amount: string,
  { type = 'expense', categoryId = null, accountId = null, currencyId = UAH }: Partial<OverviewDays[number]> = {},
): OverviewDays[number] => ({ day: `2026-10-${day}`, type, categoryId, accountId, currencyId, amount });

const input = (days: OverviewDays, now = new Date(2026, 9, 12, 15)): OverviewViewInput => ({
  days,
  month: new Date(2026, 9, 1),
  now,
  categories,
  accounts: [loan],
  mainCurrencyId: UAH,
  rate: (from, to) => (from === USD && to === UAH ? '41' : null),
});

describe('buildOverview', () => {
  it('adds up each category and debt for the month, largest first, with its share', () => {
    const view = buildOverview(
      input([
        entry('01', '300.00', { categoryId: 'groceries' }),
        entry('03', '200.00', { categoryId: 'groceries' }),
        entry('03', '100.00', { categoryId: 'cafe' }),
        entry('05', '400.00', { accountId: 'loan' }),
        entry('05', '9000.00', { type: 'income', categoryId: 'salary' }),
      ]),
    );
    expect(view.expense.total).toBe('1000.00');
    expect(view.expense.rows.map((row) => [row.key, row.total, row.share])).toEqual([
      ['category:groceries', '500.00', 0.5],
      ['debt:loan', '400.00', 0.4],
      ['category:cafe', '100.00', 0.1],
    ]);
    expect(view.income.total).toBe('9000.00');
    expect(view.income.rows.map((row) => row.key)).toEqual(['category:salary']);
  });

  it('lays out every day of the month, each split in the order of the rows', () => {
    const view = buildOverview(
      input([
        entry('03', '100.00', { categoryId: 'cafe' }),
        entry('03', '200.00', { categoryId: 'groceries' }),
        entry('01', '300.00', { categoryId: 'groceries' }),
      ]),
    );
    expect(view.expense.days).toHaveLength(31);
    expect(view.expense.days[0]).toEqual({ day: 1, total: '300.00', parts: [{ key: 'category:groceries', amount: '300.00' }] });
    expect(view.expense.days[1]).toEqual({ day: 2, total: '0.00', parts: [] });
    expect(view.expense.days[2].parts).toEqual([
      { key: 'category:groceries', amount: '200.00' },
      { key: 'category:cafe', amount: '100.00' },
    ]);
  });

  it('converts into the main currency, and names a currency without a rate rather than guessing', () => {
    const view = buildOverview(
      input([
        entry('02', '10.00', { categoryId: 'groceries', currencyId: USD }),
        entry('02', '50.00', { categoryId: 'groceries', currencyId: EUR }),
      ]),
    );
    expect(view.expense.total).toBe('410.00');
    expect(view.missingCurrencyIds).toEqual([EUR]);
  });

  it('keeps what was filed under nothing as a row of its own', () => {
    const view = buildOverview(input([entry('04', '70.00')]));
    expect(view.expense.rows).toEqual([{ key: 'none', source: { kind: 'none' }, total: '70.00', share: 1 }]);
  });

  it('averages over the days that have come in this month, today included', () => {
    const view = buildOverview(input([entry('01', '1200.00', { categoryId: 'groceries' })]));
    // The 12th: twelve days so far.
    expect(view.expense.perDay).toBe('100.00');
    expect(view.expense.perWeek).toBe('700.00');
  });

  it('averages over the whole of a month gone by, and not at all over one still to come', () => {
    const days = [entry('01', '3100.00', { categoryId: 'groceries' })];
    expect(buildOverview(input(days, new Date(2026, 10, 20))).expense.perDay).toBe('100.00');
    const ahead = buildOverview(input(days, new Date(2026, 8, 20)));
    expect(ahead.expense.perDay).toBeNull();
    expect(ahead.expense.perWeek).toBeNull();
  });

  it('is empty for a month with nothing in it', () => {
    const view = buildOverview(input([]));
    expect(view.expense).toMatchObject({ total: '0.00', rows: [], perDay: '0.00', perWeek: '0.00' });
    expect(view.expense.days.every((day) => day.parts.length === 0)).toBe(true);
  });
});

describe('foldRows', () => {
  const rows = (count: number): OverviewRow[] =>
    Array.from({ length: count }, (_, index) => ({
      key: `category:${index}`,
      source: { kind: 'none' },
      total: `${10 - index}.00`,
      share: 0.1,
    }));

  it('shows the first three and folds the rest into one, with their total', () => {
    const folded = foldRows(rows(6));
    expect(folded.shown.map((row) => row.key)).toEqual(['category:0', 'category:1', 'category:2']);
    expect(folded.more).toMatchObject({ total: '18.00' });
    expect(folded.more?.rows).toHaveLength(3);
    expect(folded.more?.share).toBeCloseTo(0.3);
  });

  it('shows a single row left over rather than folding it away', () => {
    expect(foldRows(rows(4))).toMatchObject({ more: null });
    expect(foldRows(rows(4)).shown).toHaveLength(4);
  });
});

describe('sourceColor', () => {
  it("takes the category's or the debt's own color, and gray without one", () => {
    expect(sourceColor({ kind: 'category', category: categories[0] })).toBe('#22aa55');
    expect(sourceColor({ kind: 'debt', account: loan })).toBe('#3366cc');
    expect(sourceColor({ kind: 'category', category: categories[1] })).toBe(NEUTRAL_COLOR);
    expect(sourceColor({ kind: 'none' })).toBe(NEUTRAL_COLOR);
  });
});
