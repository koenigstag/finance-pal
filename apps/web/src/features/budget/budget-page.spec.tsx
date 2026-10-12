import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { defineAbilityFor, type MemberRole } from '@ft/shared-contracts';
import '@/i18n';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { GroupScopeContext } from '@/features/groups/group-context';
import { queryKeys } from '@/lib/query-keys';
import { BudgetPage } from './budget-page';
import type { Budget, BudgetTotals } from './queries';

const groupId = '11111111-1111-4111-8111-111111111111';
const UAH = 1;
const USD = 2;

const category = (id: string, name: string, type: Category['type'], sortOrder: number): Category => ({
  id,
  groupId,
  parentId: null,
  type,
  name,
  icon: null,
  color: null,
  sortOrder,
  archived: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const categories = [
  category('groceries', 'Groceries', 'expense', 0),
  category('cafe', 'Cafe', 'expense', 1),
  category('salary', 'Salary', 'income', 0),
];
const piggy = {
  id: 'piggy',
  groupId,
  type: 'savings',
  name: 'Piggy bank',
  currencyId: USD,
  isFavourite: false,
  icon: null,
  color: null,
  description: null,
  isIncludedInBalance: true,
  notificationBank: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  balance: '80.00',
  plannedBalance: '80.00',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies Account;

const line = (id: string, target: { categoryId?: string; accountId?: string }, amount: string, currencyId: number): Budget => ({
  id,
  groupId,
  month: '2026-10',
  categoryId: target.categoryId ?? null,
  accountId: target.accountId ?? null,
  amount,
  currencyId,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const october = {
  lines: [
    line('l1', { categoryId: 'groceries' }, '15000.00', UAH),
    line('l2', { accountId: 'piggy' }, '200.00', USD),
    line('l3', { categoryId: 'salary' }, '35000.00', UAH),
  ],
  totals: {
    categories: [
      { categoryId: 'groceries', type: 'expense', currencyId: UAH, recorded: '1300.00', planned: '800.00' },
      { categoryId: 'cafe', type: 'expense', currencyId: UAH, recorded: '500.00', planned: '0' },
    ],
    accounts: [{ accountId: 'piggy', recorded: '80.00', planned: '0' }],
  } satisfies BudgetTotals,
};
const nothing = { lines: [] as Budget[], totals: { categories: [], accounts: [] } as BudgetTotals };

// Seeded rather than fetched: the page's arithmetic and what it offers is the point here.
const wrapper = (month: string, role: MemberRole = 'owner') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.profile, { displayName: 'Me', startDayOfWeek: 1, mainCurrencyId: UAH, language: 'en', exchangeRates: null });
  queryClient.setQueryData(queryKeys.currencies, [
    { id: UAH, code: 'UAH', name: 'Hryvnia', symbol: '₴' },
    { id: USD, code: 'USD', name: 'Dollar', symbol: '$' },
  ]);
  queryClient.setQueryData(queryKeys.exchangeRates, {
    base: 'UAH',
    rates: { USD: '41' },
    publishedOn: '2026-10-12',
    provider: 'test',
    attribution: null,
  });
  queryClient.setQueryData(queryKeys.allCategories(groupId), categories);
  queryClient.setQueryData(queryKeys.allAccounts(groupId), [piggy]);
  for (const key of ['2026-09', '2026-10', '2026-11', '2026-12']) {
    const data = key === '2026-10' ? october : nothing;
    queryClient.setQueryData(queryKeys.budgetLines(groupId, key), data.lines);
    queryClient.setQueryData(queryKeys.budgetTotals(groupId, key), data.totals);
  }
  const group = { id: groupId, name: 'Home', ownerId: 'u1', archivedAt: null, role };
  const scope = { group, ability: defineAbilityFor({ role, archived: false }) };

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/g/${groupId}/budget?month=${month}`]}>
        <GroupScopeContext.Provider value={scope}>{children}</GroupScopeContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('BudgetPage', () => {
  it('shows each line against what was recorded and planned', () => {
    render(<BudgetPage />, { wrapper: wrapper('2026-10') });

    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getByText('₴1,300.00')).toBeTruthy();
    expect(screen.getByText('of ₴15,000.00')).toBeTruthy();
    // 15 000 less the 1 300 recorded and the 800 still planned.
    expect(screen.getByText('₴12,900.00 left')).toBeTruthy();
    expect(screen.getByText('₴800.00 planned')).toBeTruthy();
    // The savings line, in the account's currency.
    expect(screen.getByText('Piggy bank')).toBeTruthy();
    expect(screen.getByText('$120.00 to go')).toBeTruthy();
  });

  it('shows what the budgeted income leaves once everything else budgeted is taken out', () => {
    render(<BudgetPage />, { wrapper: wrapper('2026-10') });

    // 35 000 of salary less 15 000 of groceries and 200 USD (at 41) for the piggy bank.
    expect(screen.getByText('Available to budget').parentElement?.textContent).toContain('₴11,800.00');
  });

  it('folds the categories outside the budget into one row, which opens to list them', () => {
    render(<BudgetPage />, { wrapper: wrapper('2026-10') });

    const fold = screen.getByRole('button', { name: /Not in budget/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(fold.textContent).toContain('₴500.00');
    expect(screen.queryByText('Cafe')).toBeNull();

    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Cafe')).toBeTruthy();
  });

  it('starts a month nobody budgeted empty, offering to add', () => {
    render(<BudgetPage />, { wrapper: wrapper('2026-11') });

    expect(screen.getAllByText('Nothing budgeted this month').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Add to budget' }).length).toBeGreaterThan(0);
  });

  it('offers nothing to change to a viewer', () => {
    render(<BudgetPage />, { wrapper: wrapper('2026-11', 'viewer') });

    expect(screen.queryByRole('button', { name: 'Add to budget' })).toBeNull();
    expect(screen.getAllByText('Nobody has set a budget for this month.').length).toBeGreaterThan(0);
  });
});
