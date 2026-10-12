import type { Account, Budget, Category } from '@ft/api-database';
import { effectiveRates } from '@ft/shared-contracts';
import type { AccountWithBalance } from '../../ledger/accounts/accounts.service';
import type { OverviewDayTotal } from '../../ledger/overview/overview-days';
import { Converter, accountsReport, budgetReport, categoryTree, moneyByCategory, type ReportContext } from './mcp-reports';

const UAH = 1;
const USD = 2;
const EUR = 3;
const CODES: Record<number, string> = { [UAH]: 'UAH', [USD]: 'USD', [EUR]: 'EUR' };
const codeOf = (id: number) => CODES[id];

// 1 USD = 41 UAH; nothing quotes EUR.
function context(): ReportContext {
  const rates = effectiveRates('UAH', { base: 'UAH', rates: { UAH: '1', USD: '41' } }, null);
  return { codeOf, mainCurrencyId: UAH, converter: new Converter(codeOf, rates) };
}

const category = (id: string, type: 'expense' | 'income', sortOrder: number, parentId: string | null = null) =>
  ({ id, name: id, type, parentId, sortOrder, archived: false }) as unknown as Category;
const account = (id: string, type: string, currencyId: number, extra: Partial<Account> = {}) =>
  ({ id, name: id, type, currencyId, sortOrder: 0, archived: false, isIncludedInBalance: true, isFavourite: false, description: null, ...extra }) as unknown as Account;
const withBalance = (row: Account, balance: string, cachedBalance = balance): AccountWithBalance => ({
  account: { ...row, cachedBalance } as Account,
  balance,
});

describe('Converter', () => {
  it('converts at the rates, and names what it has none for', () => {
    const { converter } = context();
    expect(converter.convert('10.00', USD, UAH)).toBe('410.00');
    expect(converter.convert('5.00', EUR, UAH)).toBeNull();
    expect(converter.sum([{ amount: '1.00', currencyId: USD }, { amount: '9.00', currencyId: EUR }, { amount: '0.50', currencyId: UAH }], UAH)).toBe(
      '41.50',
    );
    expect(converter.missingCurrencies).toEqual(['EUR']);
  });
});

describe('accountsReport', () => {
  it('totals the accounts counted, in the main currency', () => {
    const report = accountsReport(
      [
        withBalance(account('Card', 'regular', UAH, { isFavourite: true }), '1000.00', '700.00'),
        withBalance(account('Dollars', 'savings', USD), '100.00'),
        withBalance(account('Hidden', 'regular', UAH, { isIncludedInBalance: false }), '5000.00'),
        withBalance(account('Old', 'regular', UAH, { archived: true }), '300.00'),
      ],
      context(),
    );
    expect(report.total).toEqual({ amount: '5100.00', currency: 'UAH' });
    expect(report.accounts[0]).toEqual({
      id: 'Card',
      name: 'Card',
      type: 'regular',
      currency: 'UAH',
      balance: '1000.00',
      plannedBalance: '700.00',
      countedInTotal: true,
      favourite: true,
    });
    expect(report.accounts[1]).toMatchObject({ balanceInMainCurrency: '4100.00', countedInTotal: true });
    expect(report.accounts[2].countedInTotal).toBe(false);
    expect(report.accounts[3]).toMatchObject({ countedInTotal: false, archived: true });
  });
});

describe('categoryTree', () => {
  it('nests subcategories under their category, in order', () => {
    const tree = categoryTree([
      category('Transport', 'expense', 2),
      category('Taxi', 'expense', 1, 'Transport'),
      category('Food', 'expense', 1),
    ]);
    expect(tree).toEqual([
      { id: 'Food', name: 'Food', type: 'expense' },
      { id: 'Transport', name: 'Transport', type: 'expense', subcategories: [{ id: 'Taxi', name: 'Taxi' }] },
    ]);
  });
});

describe('moneyByCategory', () => {
  const food = category('Food', 'expense', 1);
  const salary = category('Salary', 'income', 1);
  const loan = account('Loan', 'debt', UAH);
  const day = (date: string, amount: string, overrides: Partial<OverviewDayTotal> = {}): OverviewDayTotal => ({
    day: date,
    type: 'expense',
    categoryId: food.id,
    accountId: null,
    currencyId: UAH,
    amount,
    ...overrides,
  });

  it('adds up by category and debt, largest first, with shares and averages', () => {
    const days = [
      day('2026-10-01', '300.00'),
      day('2026-10-02', '10.00', { currencyId: USD }),
      day('2026-10-02', '100.00', { categoryId: null, accountId: loan.id }),
      day('2026-10-03', '50.00', { categoryId: null }),
      day('2026-10-03', '7.00', { currencyId: EUR }),
      day('2026-10-01', '9000.00', { type: 'income', categoryId: salary.id }),
    ];
    const report = moneyByCategory(days, 'expense', { categories: [food, salary], accounts: [loan], daysSoFar: 4, withDays: true }, context());
    expect(report).toEqual({
      total: '860.00',
      perDay: '215.00',
      perWeek: '1505.00',
      rows: [
        { name: 'Food', kind: 'category', id: 'Food', amount: '710.00', share: '82.6%' },
        { name: 'Loan', kind: 'debt', id: 'Loan', amount: '100.00', share: '11.6%' },
        { name: 'No category', kind: 'uncategorized', amount: '50.00', share: '5.8%' },
      ],
      days: [
        { day: '2026-10-01', amount: '300.00' },
        { day: '2026-10-02', amount: '510.00' },
        { day: '2026-10-03', amount: '50.00' },
      ],
    });
  });

  it('has no averages before the period has begun', () => {
    const report = moneyByCategory([], 'income', { categories: [], accounts: [], daysSoFar: 0, withDays: false }, context());
    expect(report).toEqual({ total: '0.00', perDay: null, perWeek: null, rows: [] });
  });
});

describe('budgetReport', () => {
  const groceries = category('Groceries', 'expense', 1);
  const cafe = category('Cafe', 'expense', 2);
  const salary = category('Salary', 'income', 1);
  const piggy = account('Piggy', 'savings', USD);
  const line = (target: { categoryId?: string; accountId?: string }, amount: string, currencyId = UAH) =>
    ({ id: `line-${amount}`, categoryId: target.categoryId ?? null, accountId: target.accountId ?? null, amount, currencyId }) as Budget;

  it('measures each line in its currency, and totals each section in the main one', () => {
    const report = budgetReport(
      [line({ categoryId: groceries.id }, '15000'), line({ accountId: piggy.id }, '100', USD), line({ categoryId: salary.id }, '50000')],
      {
        categories: [
          { categoryId: groceries.id, type: 'expense', currencyId: UAH, recorded: '1300.00', planned: '800.00' },
          { categoryId: groceries.id, type: 'expense', currencyId: USD, recorded: '10.00', planned: '0' },
          { categoryId: cafe.id, type: 'expense', currencyId: UAH, recorded: '450.00', planned: '0' },
          { categoryId: null, type: 'expense', currencyId: UAH, recorded: '20.00', planned: '0' },
        ],
        accounts: [{ accountId: piggy.id, recorded: '40.00', planned: '0' }],
      },
      { categories: [groceries, cafe, salary], accounts: [piggy] },
      context(),
    );

    expect(report.sections.map((section) => section.section)).toEqual(['expense', 'savings', 'income']);
    const [expense, savings, income] = report.sections;
    expect(expense.lines).toEqual([
      {
        name: 'Groceries',
        budgeted: '15000',
        recorded: '1710.00',
        planned: '800.00',
        remaining: '12490.00',
        currency: 'UAH',
        usedOfBudget: '11.4%',
      },
    ]);
    expect(expense.total).toEqual({ budgeted: '15000.00', recorded: '1710.00', currency: 'UAH' });
    expect(expense.notInBudget).toEqual({
      total: '470.00',
      rows: [
        { name: 'Cafe', amount: '450.00' },
        { name: 'No category', amount: '20.00' },
      ],
    });
    expect(savings.lines[0]).toMatchObject({
      name: 'Piggy',
      budgeted: '100',
      recorded: '40.00',
      planned: '0.00',
      remaining: '60.00',
      currency: 'USD',
    });
    expect(savings.total).toEqual({ budgeted: '4100.00', recorded: '1640.00', currency: 'UAH' });
    expect(income.lines[0]).toMatchObject({ recorded: '0.00', remaining: '50000.00', usedOfBudget: '0.0%' });
  });

  it('reports a month nobody budgeted by what was spent in it', () => {
    const report = budgetReport(
      [],
      { categories: [{ categoryId: cafe.id, type: 'expense', currencyId: UAH, recorded: '99.00', planned: '0' }], accounts: [] },
      { categories: [cafe], accounts: [] },
      context(),
    );
    expect(report.sections).toEqual([
      { section: 'expense', lines: [], notInBudget: { total: '99.00', rows: [{ name: 'Cafe', amount: '99.00' }] } },
    ]);
  });
});
