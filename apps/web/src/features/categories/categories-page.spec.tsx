import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineAbilityFor } from '@ft/shared-contracts';
import '@/i18n';
import { GroupScopeContext } from '@/features/groups/group-context';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';
import { CategoriesPage } from './categories-page';
import type { Category } from './queries';

const groupId = '11111111-1111-4111-8111-111111111111';
const group = { id: groupId, name: 'Home', ownerId: 'u1', archivedAt: null, role: 'owner' as const };

const category = (id: string, overrides: Partial<Category> = {}): Category => ({
  id,
  groupId,
  parentId: null,
  type: 'expense',
  name: id,
  icon: null,
  color: null,
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

// Two categories, one of them with two subcategories: enough of a tree to move a row at either
// level. Then what has been put away — one category with a subcategory that went along with it,
// and one subcategory archived on its own, under a category still in use.
const categories = [
  category('rent', { name: 'Rent', sortOrder: 0 }),
  category('food', { name: 'Food', sortOrder: 1 }),
  category('bread', { name: 'Bread', parentId: 'food', sortOrder: 0 }),
  category('lunch', { name: 'Lunch', parentId: 'food', sortOrder: 1 }),
  category('taxi', { name: 'Taxi', sortOrder: 2, archived: true, archivedAt: '2026-02-01T00:00:00.000Z' }),
  category('metro', { name: 'Metro', parentId: 'taxi', archived: true, archivedAt: '2026-02-01T00:00:00.000Z' }),
  category('coffee', { name: 'Coffee', parentId: 'food', sortOrder: 5, archived: true, archivedAt: '2026-02-01T00:00:00.000Z' }),
];
const live = categories.filter((candidate) => !candidate.archived);

// Seeded rather than fetched: this is about rearranging the list, not about loading it.
const wrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  // The categories page asks for archived ones too; the live list is seeded as well, for whatever
  // reads it while the page is open.
  queryClient.setQueryData(queryKeys.allCategories(groupId), categories);
  queryClient.setQueryData(queryKeys.categories(groupId), live);
  const scope = { group, ability: defineAbilityFor({ role: group.role, archived: false }) };

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/g/${groupId}/categories`]}>
        <GroupScopeContext.Provider value={scope}>{children}</GroupScopeContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
};

// The rows in the order they are drawn, each named by the grip that moves it.
const rowNames = () => screen.getAllByRole('button', { name: /^Move/ }).map((grip) => grip.getAttribute('aria-label'));

const startReordering = () => fireEvent.click(screen.getByRole('button', { name: 'Reorder' }));
// The page's action is drawn twice, once for each layout: a button from md up, a floating one on
// a phone. Only one of the two is ever on screen; without stylesheets, both are here.
const saveOrder = () => fireEvent.click(screen.getAllByRole('button', { name: 'Save order' })[0]);
const moveDown = (name: string) => fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'ArrowDown' });

describe('CategoriesPage reordering', () => {
  const reorder = vi.spyOn(api.categories, 'reorder');
  // A saved reorder refetches the list, which would otherwise go looking for a server.
  const list = vi.spyOn(api.categories, 'list');

  beforeEach(() => {
    reorder.mockReset();
    reorder.mockResolvedValue({ status: 200, body: [] } as never);
    list.mockReset();
    list.mockResolvedValue({ status: 200, body: categories } as never);
    render(<CategoriesPage />, { wrapper: wrapper() });
  });

  it('only offers to rearrange the list once asked, and puts the rows back afterwards', () => {
    expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull();
    // A row opens the category it names until the list is being rearranged.
    expect(screen.getByRole('button', { name: /^Food/ })).toBeTruthy();

    startReordering();
    expect(rowNames()).toEqual(['Move “Rent”', 'Move “Food”']);
    expect(screen.queryByRole('button', { name: 'Reorder' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reorder' })).toBeTruthy();
  });

  it('saves the whole tree in the order it ended up in, parents and subcategories alike', async () => {
    startReordering();
    fireEvent.click(screen.getByRole('button', { name: 'Subcategories of “Food”' }));
    moveDown('Move “Rent”');
    moveDown('Move “Bread”');

    expect(rowNames()).toEqual(['Move “Food”', 'Move “Lunch”', 'Move “Bread”', 'Move “Rent”']);

    saveOrder();

    await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
    expect(reorder.mock.calls[0][0]).toMatchObject({
      params: { groupId },
      body: { categoryIds: ['food', 'lunch', 'bread', 'rent'] },
    });
    // Saved: the list goes back to being read, and the fetched order takes over again.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull());
  });

  it('keeps the order to try again when saving it fails', async () => {
    reorder.mockRejectedValue(new Error('offline'));

    startReordering();
    moveDown('Move “Rent”');
    saveOrder();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeTruthy();
    expect(rowNames()).toEqual(['Move “Food”', 'Move “Rent”']);
  });

  it('sends the list as it stands even when no row moved, so the numbering settles either way', async () => {
    startReordering();
    saveOrder();

    await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1));
    expect(reorder.mock.calls[0][0]).toMatchObject({ body: { categoryIds: ['rent', 'food', 'bread', 'lunch'] } });
  });
});

// A row in the list is opened by name — the leading anchor because an archived subcategory's row
// carries its parent's name as well. A row inside the Archived fold is hidden from a query by
// role, so that one is found by its text.
const openCategory = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
const openArchived = (name: string) => fireEvent.click(screen.getByText(name));
const confirm = (label: string) =>
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: label }));

describe('CategoriesPage archiving', () => {
  const archive = vi.spyOn(api.categories, 'archive');
  const restore = vi.spyOn(api.categories, 'restore');
  // Either one refetches the categories, which would otherwise go looking for a server.
  const list = vi.spyOn(api.categories, 'list');

  beforeEach(() => {
    archive.mockReset();
    archive.mockResolvedValue({ status: 200, body: { ...categories[1], archived: true } } as never);
    restore.mockReset();
    restore.mockResolvedValue({ status: 200, body: { ...categories[4], archived: false } } as never);
    list.mockReset();
    list.mockResolvedValue({ status: 200, body: categories } as never);
    render(<CategoriesPage />, { wrapper: wrapper() });
  });

  it('keeps what is put away out of the list, in a fold that counts it', () => {
    // Two rows put away, not three: the subcategory archived along with Taxi travels with it.
    expect(screen.getByText('Archived')).toBeTruthy();
    expect(screen.getByText('(2)')).toBeTruthy();
    expect(screen.getByText('Taxi').closest('details')).toBeTruthy();
    expect(screen.getByText('Coffee').closest('details')).toBeTruthy();
    expect(screen.queryByText('Metro')).toBeNull();
    // What is still in use stays in the list itself.
    expect(screen.getByText('Rent').closest('details')).toBeNull();
  });

  it('archives a category once the confirmation is accepted, subcategories and all', async () => {
    openCategory('Food');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation.textContent).toContain('Archive “Food”?');
    expect(confirmation.textContent).toContain('Its 2 subcategories go with it.');
    expect(archive).not.toHaveBeenCalled();

    confirm('Archive');
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect(archive.mock.calls[0][0]).toMatchObject({ params: { groupId, categoryId: 'food' }, body: {} });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('offers an archived category its way back, and no way to archive it again', async () => {
    openArchived('Taxi');
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Restore “Taxi”?');

    confirm('Restore');
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    expect(restore.mock.calls[0][0]).toMatchObject({ params: { groupId, categoryId: 'taxi' }, body: {} });
  });
});
