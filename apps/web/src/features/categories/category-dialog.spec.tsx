import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { api } from '@/lib/api/client';
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
  sortOrder: 0,
  archived: false,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const wrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });

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
