import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineAbilityFor } from '@ft/shared-contracts';
import '@/i18n';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { GroupScopeContext } from '@/features/groups/group-context';
import { queryKeys } from '@/lib/query-keys';
import { RootStore } from '@/stores/root-store';
import { StoresProvider } from '@/stores/stores-context';
import { OverviewPage } from './overview-page';
import type { OverviewDays } from './queries';

const groupId = '11111111-1111-4111-8111-111111111111';
const UAH = 1;

const category = (id: string, name: string, type: Category['type']): Category => ({
  id,
  groupId,
  parentId: null,
  type,
  name,
  icon: null,
  color: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const categories = [
  category('groceries', 'Groceries', 'expense'),
  category('cafe', 'Cafe', 'expense'),
  category('transport', 'Transport', 'expense'),
  category('gifts', 'Gifts', 'expense'),
  category('salary', 'Salary', 'income'),
];
const loan = {
  id: 'loan',
  groupId,
  type: 'debt',
  name: 'Loan',
  currencyId: UAH,
  isFavourite: false,
  icon: null,
  color: null,
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

const spent = (day: string, amount: string, target: { categoryId?: string; accountId?: string } = {}): OverviewDays[number] => ({
  day: `2026-10-${day}`,
  type: 'expense',
  categoryId: target.categoryId ?? null,
  accountId: target.accountId ?? null,
  currencyId: UAH,
  amount,
});
const october: OverviewDays = [
  spent('01', '300.00', { categoryId: 'groceries' }),
  spent('03', '200.00', { categoryId: 'groceries' }),
  spent('03', '100.00', { categoryId: 'cafe' }),
  spent('05', '150.00', { categoryId: 'transport' }),
  spent('06', '400.00', { accountId: 'loan' }),
  spent('07', '50.00', { categoryId: 'gifts' }),
  spent('08', '30.00'),
  { ...spent('05', '9000.00', { categoryId: 'salary' }), type: 'income' },
];

// Where a row leads, read off the URL.
function Location() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

// Seeded rather than fetched: the page's arithmetic and what it offers is the point here.
const renderPage = (entry: string, stores = new RootStore()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.profile, { displayName: 'Me', startDayOfWeek: 1, mainCurrencyId: UAH, language: 'en', exchangeRates: null });
  queryClient.setQueryData(queryKeys.currencies, [{ id: UAH, code: 'UAH', name: 'Hryvnia', symbol: '₴' }]);
  queryClient.setQueryData(queryKeys.exchangeRates, { base: 'UAH', rates: {}, publishedOn: '2026-10-12', provider: 'test', attribution: null });
  queryClient.setQueryData(queryKeys.allCategories(groupId), categories);
  queryClient.setQueryData(queryKeys.allAccounts(groupId), [loan]);
  for (const month of ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']) {
    queryClient.setQueryData(queryKeys.overviewDays(groupId, month), month === '2026-10' ? october : []);
  }
  const group = { id: groupId, name: 'Home', ownerId: 'u1', archivedAt: null, role: 'owner' as const };
  const scope = { group, ability: defineAbilityFor({ role: 'owner', archived: false }) };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <StoresProvider stores={stores}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>
          <GroupScopeContext.Provider value={scope}>
            <Routes>
              <Route path="/g/:groupId/overview" element={children} />
              <Route path="*" element={<Location />} />
            </Routes>
          </GroupScopeContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    </StoresProvider>
  );
  return render(<OverviewPage />, { wrapper });
};

describe('OverviewPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 15));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the month's spending on average and in all", () => {
    renderPage(`/g/${groupId}/overview?month=2026-10`);

    // 1 230 over the twelve days so far.
    expect(screen.getByText('₴102.50')).toBeTruthy();
    expect(screen.getByText('₴717.50')).toBeTruthy();
    expect(screen.getByText('₴1,230.00')).toBeTruthy();
  });

  it('lists the three largest with their share, and folds the rest into one row that opens', () => {
    renderPage(`/g/${groupId}/overview?month=2026-10`);

    expect(screen.getByText('Groceries')).toBeTruthy();
    // 500 of 1 230.
    expect(screen.getByText('40.7%')).toBeTruthy();
    expect(screen.getByText('Loan')).toBeTruthy();
    expect(screen.getByText('Debt')).toBeTruthy();
    expect(screen.getByText('Transport')).toBeTruthy();
    expect(screen.queryByText('Cafe')).toBeNull();

    const more = screen.getByRole('button', { name: /More/ });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.textContent).toContain('₴180.00');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Cafe')).toBeTruthy();
    expect(screen.getByText('Gifts')).toBeTruthy();
    expect(screen.getByText('No category')).toBeTruthy();
  });

  it('shows what was received on the income tab', () => {
    renderPage(`/g/${groupId}/overview?month=2026-10`);

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Income' }), { button: 0 });
    expect(screen.getByText('Salary')).toBeTruthy();
    expect(screen.queryByText('Groceries')).toBeNull();
  });

  it("leads from a category to the month's transactions in it", () => {
    renderPage(`/g/${groupId}/overview?month=2026-10`);

    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    expect(screen.getByTestId('location').textContent).toBe(`/g/${groupId}/transactions?month=2026-10&category=groceries`);
  });

  it('says so for a month with nothing in it', () => {
    renderPage(`/g/${groupId}/overview?month=2026-11`);

    expect(screen.getAllByText('Nothing spent this month').length).toBeGreaterThan(0);
  });

  it('opens on the month another page was last on, and passes its own on', async () => {
    const stores = new RootStore();
    stores.month.setMonth('2026-11');
    renderPage(`/g/${groupId}/overview`, stores);
    expect(screen.getByText('November 2026')).toBeTruthy();

    // The strip eases over to the month before, then the page moves to it.
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await vi.waitFor(() => expect(stores.month.month).toBe('2026-10'));
    expect(screen.getByText('October 2026')).toBeTruthy();
  });
});
