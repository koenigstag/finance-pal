import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineAbilityFor, type MemberRole } from '@ft/shared-contracts';
import '@/i18n';
import { GroupScopeContext } from '@/features/groups/group-context';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';
import { AccountsPage } from './accounts-page';
import type { Account } from './queries';

const groupId = '11111111-1111-4111-8111-111111111111';

const account = (id: string, overrides: Partial<Account> = {}): Account => ({
  id,
  groupId,
  type: 'regular',
  name: id,
  currencyId: 1,
  isFavourite: false,
  icon: null,
  color: null,
  description: null,
  isIncludedInBalance: true,
  notificationBank: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  balance: '10.00',
  plannedBalance: '10.00',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

// One of each: an account in use, and one already put away — still flagged the group's favourite,
// as archiving leaves the flag alone.
const wallet = account('wallet', { name: 'Wallet' });
const oldCard = account('old-card', {
  name: 'Old card',
  isFavourite: true,
  archived: true,
  archivedAt: '2026-02-01T00:00:00.000Z',
});

// Seeded rather than fetched: this is about what the page offers for an account, not about loading
// it. The accounts page asks for archived accounts too, so both lists are seeded — the one it reads
// and the live one the dialogs it renders read.
const wrapper = (role: MemberRole = 'owner') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.allAccounts(groupId), [wallet, oldCard]);
  queryClient.setQueryData(queryKeys.accounts(groupId), [wallet]);
  queryClient.setQueryData(queryKeys.categories(groupId), []);
  queryClient.setQueryData(queryKeys.currencies, [{ id: 1, code: 'USD', name: 'US dollar' }]);
  queryClient.setQueryData(queryKeys.profile, { id: 'u1', email: 'u1@example.com', mainCurrencyId: 1 });
  const group = { id: groupId, name: 'Home', ownerId: 'u1', archivedAt: null, role };
  const scope = { group, ability: defineAbilityFor({ role, archived: false }) };

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/g/${groupId}/accounts`]}>
        <GroupScopeContext.Provider value={scope}>{children}</GroupScopeContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

// A row is opened by its name: the one for an archived account sits inside a fold, where a query by
// role would not look.
const openAccount = (name: string) => fireEvent.click(screen.getByText(name));
const confirm = (label: string) => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: label }));

describe('AccountsPage archiving', () => {
  const archive = vi.spyOn(api.accounts, 'archive');
  const restore = vi.spyOn(api.accounts, 'restore');
  // Either one refetches the accounts, which would otherwise go looking for a server.
  const list = vi.spyOn(api.accounts, 'list');

  beforeEach(() => {
    archive.mockReset();
    archive.mockResolvedValue({ status: 200, body: { ...wallet, archived: true } } as never);
    restore.mockReset();
    restore.mockResolvedValue({ status: 200, body: { ...oldCard, archived: false } } as never);
    list.mockReset();
    list.mockResolvedValue({ status: 200, body: [wallet, oldCard] } as never);
  });

  it('archives an account once the confirmation is accepted', async () => {
    render(<AccountsPage />, { wrapper: wrapper() });

    openAccount('Wallet');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Archive “Wallet”?');
    expect(archive).not.toHaveBeenCalled();

    confirm('Archive');
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect(archive.mock.calls[0][0]).toMatchObject({ params: { groupId, accountId: 'wallet' }, body: {} });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('offers an archived account its way back, and nothing to record on it', async () => {
    render(<AccountsPage />, { wrapper: wrapper() });

    openAccount('Old card');
    expect(screen.queryByRole('button', { name: 'Expense' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Restore “Old card”?');

    confirm('Restore');
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    expect(restore.mock.calls[0][0]).toMatchObject({ params: { groupId, accountId: 'old-card' }, body: {} });
  });

  it('takes the star off an archived favourite, in the list and in its sheet', () => {
    render(<AccountsPage />, { wrapper: wrapper() });

    // No row wears the star: a new transaction never starts on an archived account.
    expect(screen.queryByLabelText('Favourite')).toBeNull();

    openAccount('Old card');
    const star = screen.getByRole('button', { name: 'Make favourite' });
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(star.hasAttribute('disabled')).toBe(true);
  });

  it('offers neither to a viewer, who may not change accounts', () => {
    render(<AccountsPage />, { wrapper: wrapper('viewer') });

    openAccount('Wallet');
    // The sheet is open all the same: a viewer is offered what there is to read.
    expect(screen.getByRole('button', { name: 'Transactions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });
});
