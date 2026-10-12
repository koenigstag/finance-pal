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
const account = (id: string, type: Account['type'], currencyId: number) =>
  ({ id, name: id, type, currencyId, sortOrder: 0, archived: false, icon: null, color: null }) as Account;
const line = (id: string, target: { categoryId?: string; accountId?: string }, amount: string, currencyId = UAH) =>
  ({ id, month: '2026-10', categoryId: target.categoryId ?? null, accountId: target.accountId ?? null, amount, currencyId }) as Budget;

const groceries = category('groceries', 'expense', 1);
const transport = category('transport', 'expense', 2);
const cafe = category('cafe', 'expense', 3);
const salary = category('salary', 'income', 1);
const gifts = category('gifts', 'income', 2, true);
const piggy = account('piggy', 'savings', USD);
const loan = account('loan', 'debt', UAH);

// 1 USD = 41 UAH; nothing converts EUR.
const rate: BudgetViewInput['rate'] = (from, to) =>
  from === USD && to === UAH ? '41' : from === UAH && to === USD ? '0.02439024' : null;

// A null main currency stands for one that hasn't loaded yet.
function view(lines: Budget[], totals: Partial<BudgetTotals>, mainCurrencyId: number | null = UAH) {
  return buildBudgetView({
    lines,
    totals: { categories: [], accounts: [], ...totals },
    categories: [groceries, transport, cafe, salary, gifts],
    accounts: [piggy, loan],
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
    expect(view([], {}).sections).toEqual([]);
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
  });
});
