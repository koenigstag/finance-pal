import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// Two categories, one of them with two subcategories: enough of a tree to move a row at either level.
const categories = [
  category('rent', { name: 'Rent', sortOrder: 0 }),
  category('food', { name: 'Food', sortOrder: 1 }),
  category('bread', { name: 'Bread', parentId: 'food', sortOrder: 0 }),
  category('lunch', { name: 'Lunch', parentId: 'food', sortOrder: 1 }),
];

// Seeded rather than fetched: this is about rearranging the list, not about loading it.
const wrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.categories(groupId), categories);
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
