import { describe, expect, it } from 'vitest';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { buildBudgetView, type BudgetViewInput } from './budget-model';
import type { Budget, BudgetTotals } from './queries';

const UAH = 1;
const USD = 2;
const EUR = 3;

const category = (id: string, type: Category['type'], sortOrder: number, archived = false) =>
  ({ id, name: id, type, parentId: null, sortOrder, archived, icon: null, color: null }) as Category;
const account = (id: string, type: Account['type'], currencyId: number, balance = '0') =>
  ({ id, name: id, type, currencyId, balance, sortOrder: 0, archived: false, icon: null, color: null }) as Account;
const line = (id: string, target: { categoryId?: string; accountId?: string }, amount: string, currencyId = UAH) =>
  ({ id, month: '2026-10', categoryId: target.categoryId ?? null, accountId: target.accountId ?? null, amount, currencyId }) as Budget;

const groceries = category('groceries', 'expense', 1);
const transport = category('transport', 'expense', 2);
const cafe = category('cafe', 'expense', 3);
const salary = category('salary', 'income', 1);
const gifts = category('gifts', 'income', 2, true);
const piggy = account('piggy', 'savings', USD);
const loan = account('loan', 'debt', UAH, '-60000.00');
// Lent out, so owed back.
const lent = account('lent', 'debt', UAH, '3000.00');
const settled = account('settled', 'debt', UAH);

// 1 USD = 41 UAH; nothing converts EUR.
const rate: BudgetViewInput['rate'] = (from, to) =>
  from === USD && to === UAH ? '41' : from === UAH && to === USD ? '0.02439024' : null;

// A null main currency stands for one that hasn't loaded yet.
function view(lines: Budget[], totals: Partial<BudgetTotals>, mainCurrencyId: number | null = UAH) {
  return buildBudgetView({
    lines,
    totals: { categories: [], accounts: [], ...totals },
    categories: [groceries, transport, cafe, salary, gifts],
    accounts: [piggy, loan, lent, settled],
    mainCurrencyId: mainCurrencyId ?? undefined,
    rate,
  });
}

describe('buildBudgetView', () => {
  it('measures a category line against its money in every currency, recorded and planned apart', () => {
    const { sections } = view([line('l1', { categoryId: groceries.id }, '15000')], {
      categories: [
        { categoryId: groceries.id, type: 'expense', currencyId: UAH, recorded: '1300.00', planned: '800.00' },
        { categoryId: groceries.id, type: 'expense', currencyId: USD, recorded: '10.00', planned: '0' },
      ],
    });
    const [row] = sections[0].lines;
    expect(sections[0].kind).toBe('expense');
    expect(row).toMatchObject({ amount: '15000', recorded: '1710.00', planned: '800.00', remaining: '12490.00' });
  });

  it('goes below zero once a line is past its amount', () => {
    const { sections } = view([line('l1', { categoryId: transport.id }, '1000')], {
      categories: [{ categoryId: transport.id, type: 'expense', currencyId: UAH, recorded: '1250.50', planned: '0' }],
    });
    expect(sections[0].lines[0].remaining).toBe('-250.50');
  });

  it("measures an account line by the account's balance change, in its currency", () => {
    const { sections } = view(
      [line('l1', { accountId: piggy.id }, '200', USD), line('l2', { accountId: loan.id }, '5000')],
      {
        accounts: [
          { accountId: piggy.id, recorded: '80.00', planned: '0' },
          { accountId: loan.id, recorded: '5000.00', planned: '2000.00' },
        ],
      },
    );
    expect(sections.map((section) => section.kind)).toEqual(['savings', 'debt']);
    expect(sections[0].lines[0]).toMatchObject({ recorded: '80.00', remaining: '120.00' });
    expect(sections[1].lines[0]).toMatchObject({ recorded: '5000.00', planned: '2000.00', remaining: '-2000.00' });
    // The savings total is in the main currency.
    expect(sections[0].total).toEqual({ amount: '8200.00', recorded: '3280.00' });
  });

  it('measures a loan someone owes back by what came out of it, and settled since by that month', () => {
    const { sections } = view(
      [
        line('l1', { accountId: lent.id }, '5000'),
        line('l2', { accountId: settled.id }, '2000'),
        line('l3', { accountId: loan.id }, '6000'),
      ],
      {
        accounts: [
          { accountId: lent.id, recorded: '-2000.00', planned: '0' },
          { accountId: settled.id, recorded: '-2000.00', planned: '0' },
          { accountId: loan.id, recorded: '6000.00', planned: '0' },
        ],
      },
    );
    expect(sections[0].lines.map((row) => [row.line.id, row.incoming, row.recorded, row.remaining])).toEqual([
      ['l1', true, '2000.00', '3000.00'],
      ['l3', false, '6000.00', '0.00'],
      ['l2', true, '2000.00', '0.00'],
    ]);
  });

  it('counts a withdrawal from savings against what was put in', () => {
    const { sections } = view([line('l1', { accountId: piggy.id }, '100', USD)], {
      accounts: [{ accountId: piggy.id, recorded: '-30.00', planned: '0' }],
    });
    expect(sections[0].lines[0]).toMatchObject({ recorded: '-30.00', remaining: '130.00' });
  });

  it('gathers the categories with money but no line, largest first, with "no category" among them', () => {
    const { sections } = view([line('l1', { categoryId: groceries.id }, '15000')], {
      categories: [
        { categoryId: groceries.id, type: 'expense', currencyId: UAH, recorded: '100.00', planned: '0' },
        { categoryId: cafe.id, type: 'expense', currencyId: UAH, recorded: '300.00', planned: '200.00' },
        { categoryId: transport.id, type: 'expense', currencyId: USD, recorded: '20.00', planned: '0' },
        { categoryId: null, type: 'expense', currencyId: UAH, recorded: '50.00', planned: '0' },
        { categoryId: gifts.id, type: 'income', currencyId: UAH, recorded: '1000.00', planned: '0' },
      ],
    });
    const expenses = sections.find((section) => section.kind === 'expense');
    expect(expenses?.unbudgeted?.rows.map((row) => [row.key, row.total])).toEqual([
      ['transport', '820.00'],
      ['cafe', '500.00'],
      ['', '50.00'],
    ]);
    expect(expenses?.unbudgeted?.total).toBe('1370.00');
    // An income category with money and no line makes a section of its own, archived or not.
    const income = sections.find((section) => section.kind === 'income');
    expect(income?.lines).toEqual([]);
    expect(income?.unbudgeted?.rows[0]).toMatchObject({ key: 'gifts', total: '1000.00' });
  });

  it('leaves out a currency without a rate, and names it', () => {
    const { sections, missingCurrencyIds } = view([line('l1', { categoryId: groceries.id }, '15000')], {
      categories: [
        { categoryId: groceries.id, type: 'expense', currencyId: UAH, recorded: '100.00', planned: '0' },
        { categoryId: groceries.id, type: 'expense', currencyId: EUR, recorded: '5.00', planned: '0' },
      ],
    });
    expect(sections[0].lines[0].recorded).toBe('100.00');
    expect(missingCurrencyIds).toEqual([EUR]);
  });

  it('shows nothing for a month with no lines and no money', () => {
    expect(view([], {})).toMatchObject({ sections: [], available: null });
  });

  it('leaves available what the income lines bring in less what the other lines give out', () => {
    const { available } = view(
      [
        line('l1', { categoryId: salary.id }, '35000'),
        line('l2', { categoryId: groceries.id }, '15000'),
        line('l3', { categoryId: transport.id }, '100', USD),
        line('l4', { accountId: piggy.id }, '200', USD),
        line('l5', { accountId: loan.id }, '6000'),
      ],
      // Money outside the budget doesn't come into it.
      { categories: [{ categoryId: cafe.id, type: 'expense', currencyId: UAH, recorded: '500.00', planned: '0' }] },
    );
    // 35 000 less 15 000 and 100 USD of expenses, 200 USD put aside and 6 000 paid off, a dollar at 41.
    expect(available).toBe('1700.00');
  });

  it('goes below zero with more budgeted to give out than to come in, or nothing to come in', () => {
    expect(view([line('l1', { categoryId: salary.id }, '1000'), line('l2', { categoryId: groceries.id }, '1500')], {}).available).toBe(
      '-500',
    );
    expect(view([line('l1', { categoryId: groceries.id }, '1500')], {}).available).toBe('-1500');
    expect(view([line('l1', { accountId: piggy.id }, '200', USD)], {}).available).toBe('-8200.00');
  });

  it('counts a loan coming back as money in', () => {
    const { available } = view(
      [line('l1', { categoryId: groceries.id }, '1500'), line('l2', { accountId: lent.id }, '3000'), line('l3', { accountId: loan.id }, '1000')],
      {},
    );
    expect(available).toBe('500');
    // A debt settled and nothing moving on it this month: a line for it is money going out, a loan.
    expect(view([line('l1', { accountId: settled.id }, '700')], {}).available).toBe('-700');
  });

  it('puts expenses first and income last', () => {
    const { sections } = view(
      [
        line('l1', { categoryId: salary.id }, '1'),
        line('l2', { accountId: loan.id }, '1'),
        line('l3', { accountId: piggy.id }, '1', USD),
        line('l4', { categoryId: groceries.id }, '1'),
      ],
      {},
    );
    expect(sections.map((section) => section.kind)).toEqual(['expense', 'savings', 'debt', 'income']);
  });

  it('orders lines as the categories are ordered', () => {
    const { sections } = view(
      [line('l1', { categoryId: cafe.id }, '1'), line('l2', { categoryId: groceries.id }, '1'), line('l3', { categoryId: transport.id }, '1')],
      {},
    );
    expect(sections[0].lines.map((row) => row.line.id)).toEqual(['l2', 'l3', 'l1']);
  });

  it('waits for the main currency before adding anything up', () => {
    const { sections } = view([line('l1', { categoryId: groceries.id }, '15000')], {}, null);
    expect(sections[0].total).toBeNull();
    expect(sections[0].unbudgeted).toBeNull();
    expect(view([line('l1', { categoryId: groceries.id }, '15000')], {}, null).available).toBeNull();
  });
});
