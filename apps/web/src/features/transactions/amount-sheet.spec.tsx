import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import type { Account } from '@/features/accounts/queries';
import type { Category } from '@/features/categories/queries';
import { queryKeys } from '@/lib/query-keys';
import { AmountSheet } from './amount-sheet';
import type { AmountValues, TransactionSides } from './transaction-form-model';

const groupId = '11111111-1111-4111-8111-111111111111';

const account = (id: string, currencyId: number): Account => ({
  id,
  groupId,
  type: 'regular',
  name: id,
  currencyId,
  isFavourite: false,
  icon: null,
  color: null,
  description: null,
  isIncludedInBalance: true,
  notificationBank: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  balance: '100.00',
  plannedBalance: '100.00',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

// Two in dollars and one in euros: a transfer between the first two stays within a currency, one
// to the third crosses.
const accounts = [account('wallet', 1), account('savings', 1), account('euros', 2)];

// One in euros, one in dollars, and one with no currency of its own.
const category = (id: string, currencyId: number | null): Category => ({
  id,
  groupId,
  parentId: null,
  type: 'expense',
  name: id,
  icon: null,
  color: null,
  currencyId,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
const categories = [category('travel', 2), category('subscriptions', 1), category('food', null)];

const values: AmountValues = { amount: '0', destAmount: '', percentage: '', percentageBase: '', roundBalanceTo: '' };

const wrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.currencies, [
    { id: 1, code: 'USD', name: 'US dollar' },
    { id: 2, code: 'EUR', name: 'Euro' },
  ]);

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const open = (sides: TransactionSides) =>
  render(
    <AmountSheet
      open
      onOpenChange={() => undefined}
      sides={sides}
      accounts={accounts}
      categories={categories}
      scheduled={false}
      repeats={false}
      conversion={null}
      values={values}
      onDone={vi.fn()}
    />,
    { wrapper: wrapper() },
  );

// The fields the sheet asks for, by the label above each.
const amountFields = () =>
  screen.getAllByRole<HTMLInputElement>('textbox').map((input) => input.labels?.[0]?.textContent ?? input.id);
// Whether the sheet lays its amounts out in two columns; jsdom has no layout, so the row itself is
// what says it. The sheet renders in a portal, which is why this looks at the dialog, not at what
// render() returns.
const sideBySide = () => !!screen.getByRole('dialog').querySelector('.grid-cols-2');

describe('AmountSheet', () => {
  it('asks for one amount within a currency, and gives it the row', () => {
    open({ type: 'transfer', accountId: 'wallet', toAccountId: 'savings', categoryId: '' });

    // What leaves is what arrives, so there is one figure and nothing to set it beside.
    expect(amountFields()).toEqual(['Amount (USD)']);
    expect(sideBySide()).toBe(false);
  });

  it('asks for both amounts across currencies, side by side', () => {
    open({ type: 'transfer', accountId: 'wallet', toAccountId: 'euros', categoryId: '' });

    expect(amountFields()).toEqual(['Amount withdrawn (USD)', 'Amount received (EUR)']);
    expect(sideBySide()).toBe(true);
  });

  it('asks for one amount for an expense in no category, or one in the account’s currency or none', () => {
    for (const categoryId of ['', 'subscriptions', 'food']) {
      const { unmount } = open({ type: 'expense', accountId: 'wallet', toAccountId: '', categoryId });
      expect(amountFields()).toEqual(['Amount (USD)']);
      expect(sideBySide()).toBe(false);
      unmount();
    }
  });

  it('asks for the amount in a category of another currency as well', () => {
    const { unmount } = open({ type: 'expense', accountId: 'wallet', toAccountId: '', categoryId: 'travel' });
    expect(amountFields()).toEqual(['Amount withdrawn (USD)', 'In category (EUR)']);
    expect(sideBySide()).toBe(true);
    // Without a rate there's nothing to convert it at, and it's only recorded when it's typed.
    expect(screen.getByText(/No exchange rate for these currencies/)).toBeTruthy();
    unmount();

    open({ type: 'income', accountId: 'wallet', toAccountId: '', categoryId: 'travel' });
    expect(amountFields()).toEqual(['Amount (USD)', 'In category (EUR)']);
  });

  it('fills an amount in from the calculator, without its sign', () => {
    open({ type: 'expense', accountId: 'wallet', toAccountId: '', categoryId: '' });

    fireEvent.click(screen.getByRole('button', { name: 'Calculate the amount' }));
    for (const key of ['2', '0', 'Minus', '5', '0', 'Equals', 'Use this amount']) {
      fireEvent.click(screen.getByRole('button', { name: key }));
    }

    expect(screen.queryByRole('heading', { name: 'Calculator' })).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Amount (USD)' }).value).toBe('30');
  });
});
