import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';
import { CategoryDialog } from './category-dialog';
import type { Category } from './queries';

// jsdom has none, and the form's pickers measure themselves with one.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);
// Nor these, which the parent picker calls on the option it opens onto.
Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.releasePointerCapture = vi.fn();

const groupId = '11111111-1111-4111-8111-111111111111';

const food: Category = {
  id: 'food',
  groupId,
  parentId: null,
  type: 'expense',
  name: 'Food',
  icon: null,
  color: null,
  currencyId: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// The currencies and the profile are seeded: the form reads them for its currency picker and, for a
// new category, its default currency.
const UAH = 1;
const USD = 2;
const wrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.currencies, [
    { id: UAH, code: 'UAH', name: 'Hryvnia' },
    { id: USD, code: 'USD', name: 'US dollar' },
  ]);
  queryClient.setQueryData(queryKeys.profile, { id: 'u1', email: 'u1@example.com', mainCurrencyId: UAH });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

const open = (category?: Category) =>
  render(
    <CategoryDialog groupId={groupId} categories={[food]} type="expense" category={category} open onOpenChange={() => undefined} />,
    { wrapper: wrapper() },
  );

const archivedBox = () => screen.getByRole('checkbox', { name: 'Archived category' });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('CategoryDialog archiving', () => {
  const update = vi.spyOn(api.categories, 'update');
  const archive = vi.spyOn(api.categories, 'archive');
  const restore = vi.spyOn(api.categories, 'restore');
  // Saving refetches the categories, which would otherwise go looking for a server.
  const list = vi.spyOn(api.categories, 'list');

  beforeEach(() => {
    for (const spy of [update, archive, restore]) {
      spy.mockReset();
      spy.mockResolvedValue({ status: 200, body: food } as never);
    }
    list.mockReset();
    list.mockResolvedValue({ status: 200, body: [food] } as never);
  });

  it('archives the category when the box is ticked and the form saved', async () => {
    open(food);
    expect(archivedBox().getAttribute('aria-checked')).toBe('false');

    fireEvent.click(archivedBox());
    expect(archive).not.toHaveBeenCalled();

    save();
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect(archive.mock.calls[0][0]).toMatchObject({ params: { groupId, categoryId: 'food' }, body: {} });
    // The fields go their own way, and without the form's own field among them.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ body: { name: 'Food' } });
    expect(update.mock.calls[0][0].body).not.toHaveProperty('archived');
  });

  it('restores the category when the box is unticked', async () => {
    open({ ...food, archived: true, archivedAt: '2026-02-01T00:00:00.000Z' });
    expect(archivedBox().getAttribute('aria-checked')).toBe('true');

    fireEvent.click(archivedBox());
    save();
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    expect(restore.mock.calls[0][0]).toMatchObject({ params: { groupId, categoryId: 'food' }, body: {} });
    expect(archive).not.toHaveBeenCalled();
  });

  it('sends nothing extra for an edit that leaves the box alone', async () => {
    open(food);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Groceries' } });
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0][0]).toMatchObject({ body: { name: 'Groceries' } });
    expect(archive).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it('keeps an archived category out of the parent picker', () => {
    const away = { ...food, id: 'taxi', name: 'Taxi', archived: true };
    render(
      <CategoryDialog
        groupId={groupId}
        categories={[food, away]}
        type="expense"
        open
        onOpenChange={() => undefined}
      />,
      { wrapper: wrapper() },
    );

    fireEvent.click(screen.getByLabelText('Parent category'));
    expect(screen.getByRole('option', { name: 'Food' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Taxi' })).toBeNull();
  });

  it('does not offer the box for a category that does not exist yet', () => {
    open();

    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Archived category' })).toBeNull();
  });
});

describe('CategoryDialog currency', () => {
  const create = vi.spyOn(api.categories, 'create');
  const update = vi.spyOn(api.categories, 'update');
  const usage = vi.spyOn(api.categories, 'usage');
  const list = vi.spyOn(api.categories, 'list');
  const dollars = { ...food, id: 'subscriptions', name: 'Subscriptions', currencyId: USD };
  const usageOf = (transactionCount: number) => ({
    subcategoryCount: 0,
    transactionCount,
    plannedTransactionCount: 0,
    recurringRuleCount: 0,
    categoryRuleCount: 0,
    budgetCount: 0,
  });
  const currencyPicker = () => screen.getByLabelText<HTMLButtonElement>('Default currency');

  beforeEach(() => {
    for (const spy of [create, update]) {
      spy.mockReset();
      spy.mockResolvedValue({ status: 200, body: food } as never);
    }
    create.mockResolvedValue({ status: 201, body: food } as never);
    list.mockReset();
    list.mockResolvedValue({ status: 200, body: [food] } as never);
    usage.mockReset();
  });

  it('starts a new category in the main currency, and sends it', async () => {
    open();
    expect(currencyPicker().textContent).toContain('UAH');

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Travel' } });
    save();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ body: { name: 'Travel', parentId: null, currencyId: UAH } });
  });

  it('asks a subcategory for none: it is in its parent’s', async () => {
    render(
      <CategoryDialog groupId={groupId} categories={[food]} type="expense" defaultParentId="food" open onOpenChange={() => undefined} />,
      { wrapper: wrapper() },
    );
    expect(screen.queryByLabelText('Default currency')).toBeNull();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bakery' } });
    save();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0].body).not.toHaveProperty('currencyId');
  });

  it('lets a category without one be given one, transactions or not', () => {
    open(food);
    expect(currencyPicker().textContent).toContain('None');
    expect(currencyPicker().disabled).toBe(false);
    // Nothing to find out: a category without a currency can always be given one.
    expect(usage).not.toHaveBeenCalled();
  });

  it('keeps the currency of a category with transactions', async () => {
    usage.mockResolvedValue({ status: 200, body: usageOf(3) } as never);
    open(dollars);
    expect(currencyPicker().textContent).toContain('USD');
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(1));
    expect(currencyPicker().disabled).toBe(true);
    expect(screen.getByText('It has transactions, so its currency stays as it is.')).toBeTruthy();
  });

  it('lets the currency of one with nothing in it change', async () => {
    usage.mockResolvedValue({ status: 200, body: usageOf(0) } as never);
    open(dollars);
    await waitFor(() => expect(currencyPicker().disabled).toBe(false));
  });
});
