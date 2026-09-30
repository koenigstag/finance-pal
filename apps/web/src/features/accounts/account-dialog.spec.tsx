import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';
import { AccountDialog } from './account-dialog';
import type { Account } from './queries';

// jsdom has none, and the form's pickers measure themselves with one.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);

const groupId = '11111111-1111-4111-8111-111111111111';

const wallet: Account = {
  id: 'wallet',
  groupId,
  type: 'regular',
  name: 'Wallet',
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
};

// The currencies and the profile are seeded: the form reads them for its picker and, for a new
// account, its default currency, and neither is what these tests are about.
const wrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.currencies, [{ id: 1, code: 'USD', name: 'US dollar' }]);
  queryClient.setQueryData(queryKeys.profile, { id: 'u1', email: 'u1@example.com', mainCurrencyId: 1 });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const open = (account?: Account) =>
  render(<AccountDialog groupId={groupId} account={account} open onOpenChange={() => undefined} />, { wrapper: wrapper() });

const archivedBox = () => screen.getByRole('checkbox', { name: 'Archived account' });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('AccountDialog archiving', () => {
  const update = vi.spyOn(api.accounts, 'update');
  const archive = vi.spyOn(api.accounts, 'archive');
  const restore = vi.spyOn(api.accounts, 'restore');
  // Saving refetches the accounts, which would otherwise go looking for a server.
  const list = vi.spyOn(api.accounts, 'list');

  beforeEach(() => {
    for (const spy of [update, archive, restore]) {
      spy.mockReset();
      spy.mockResolvedValue({ status: 200, body: wallet } as never);
    }
    list.mockReset();
    list.mockResolvedValue({ status: 200, body: [wallet] } as never);
  });

  it('archives the account when the box is ticked and the form saved', async () => {
    open(wallet);
    expect(archivedBox().getAttribute('aria-checked')).toBe('false');

    fireEvent.click(archivedBox());
    expect(archive).not.toHaveBeenCalled();

    save();
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect(archive.mock.calls[0][0]).toMatchObject({ params: { groupId, accountId: 'wallet' }, body: {} });
    // The fields go their own way, and without the form's own field among them.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ body: { name: 'Wallet' } });
    expect(update.mock.calls[0][0].body).not.toHaveProperty('archived');
  });

  it('restores the account when the box is unticked', async () => {
    open({ ...wallet, archived: true, archivedAt: '2026-02-01T00:00:00.000Z' });
    expect(archivedBox().getAttribute('aria-checked')).toBe('true');

    fireEvent.click(archivedBox());
    save();
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    expect(restore.mock.calls[0][0]).toMatchObject({ params: { groupId, accountId: 'wallet' }, body: {} });
    expect(archive).not.toHaveBeenCalled();
  });

  it('sends nothing extra for an edit that leaves the box alone', async () => {
    open(wallet);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cash' } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toMatchObject({ body: { name: 'Cash' } });
    expect(archive).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('shows an archived account as out of the total, and stops taking answers about it', () => {
    open({ ...wallet, archived: true, archivedAt: '2026-02-01T00:00:00.000Z' });

    // The account still asks to be counted; being put away is what decides it.
    const counted = screen.getByRole('checkbox', { name: 'Include in total balance' });
    expect(counted.getAttribute('aria-checked')).toBe('false');
    expect(counted.getAttribute('data-disabled')).not.toBeNull();
    expect(screen.getByText('An archived account is out of the total either way.')).toBeTruthy();
  });

  it('does not offer the box for an account that does not exist yet', () => {
    open();

    expect(screen.getByLabelText('Include in total balance')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Archived account' })).toBeNull();
  });
});
