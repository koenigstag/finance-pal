import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import type { Account } from '@/features/accounts/queries';
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for one amount within a currency, and gives it the row', () => {
    open({ type: 'transfer', accountId: 'wallet', toAccountId: 'savings' });

    // What leaves is what arrives, so there is one figure and nothing to set it beside.
    expect(amountFields()).toEqual(['Amount (USD)']);
    expect(sideBySide()).toBe(false);
  });

  it('asks for both amounts across currencies, side by side', () => {
    open({ type: 'transfer', accountId: 'wallet', toAccountId: 'euros' });

    expect(amountFields()).toEqual(['Amount withdrawn (USD)', 'Amount received (EUR)']);
    expect(sideBySide()).toBe(true);
  });

  it('asks for one amount for anything that is not a transfer', () => {
    open({ type: 'expense', accountId: 'wallet', toAccountId: '' });

    expect(amountFields()).toEqual(['Amount (USD)']);
    expect(sideBySide()).toBe(false);
  });

  it('fills an amount in from the calculator, without its sign', () => {
    open({ type: 'expense', accountId: 'wallet', toAccountId: '' });

    fireEvent.click(screen.getByRole('button', { name: 'Calculate the amount' }));
    for (const key of ['2', '0', 'Minus', '5', '0', 'Equals', 'Use this amount']) {
      fireEvent.click(screen.getByRole('button', { name: key }));
    }

    expect(screen.queryByRole('heading', { name: 'Calculator' })).toBeNull();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Amount (USD)' }).value).toBe('30');
  });

  it('sits on a keyboard drawn over the page, as on iOS, rather than behind it', () => {
    // The keyboard leaves 460px of an 800px screen to see, and the page keeps its height.
    const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 800);
    open({ type: 'expense', accountId: 'wallet', toAccountId: '' });

    act(() => {
      viewport.height = 460;
      viewport.dispatchEvent(new Event('resize'));
    });

    // jsdom has no layout, so what the sheet is told is what says where it goes.
    const sheet = screen.getByRole('dialog');
    expect(sheet.style.getPropertyValue('--keyboard-inset')).toBe('340px');
    expect(sheet.style.getPropertyValue('--visible-height')).toBe('460px');
  });
});
