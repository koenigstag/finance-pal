import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { queryKeys } from '@/lib/query-keys';
import { AccountsTotal } from './accounts-total';
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

// Everything in the main currency, so the total is a plain sum and no rates are needed for it.
const wrapper = (accounts: Account[]) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.accounts(groupId), accounts);
  queryClient.setQueryData(queryKeys.currencies, [{ id: 1, code: 'USD', name: 'US dollar' }]);
  queryClient.setQueryData(queryKeys.profile, { id: 'u1', email: 'u1@example.com', mainCurrencyId: 1 });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const total = () => screen.getByText(/\$/).textContent;

describe('AccountsTotal', () => {
  it('adds up the accounts counted in the total', () => {
    render(<AccountsTotal groupId={groupId} />, { wrapper: wrapper([account('wallet'), account('card')]) });

    expect(total()).toContain('20');
  });

  it('leaves out an account that is not counted in it', () => {
    render(<AccountsTotal groupId={groupId} />, {
      wrapper: wrapper([account('wallet'), account('loan', { isIncludedInBalance: false })]),
    });

    expect(total()).toContain('10');
  });

  it('leaves out an archived account, whatever its own flag still says', () => {
    render(<AccountsTotal groupId={groupId} />, {
      wrapper: wrapper([
        account('wallet'),
        // Archiving leaves the flag alone, so this one still asks to be counted: being put away
        // is what decides it.
        account('old-card', { archived: true, archivedAt: '2026-02-01T00:00:00.000Z' }),
      ]),
    });

    expect(total()).toContain('10');
  });
});
