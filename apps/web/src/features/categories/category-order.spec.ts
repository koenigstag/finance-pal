import { describe, expect, it } from 'vitest';
import { buildTree, move, moveSubcategory, orderedIds } from './category-order';
import type { Category } from './queries';

const category = (id: string, overrides: Partial<Category> = {}): Category => ({
  id,
  groupId: 'g',
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

const categories = [
  category('food', { sortOrder: 2 }),
  category('rent', { sortOrder: 1 }),
  category('lunch', { parentId: 'food', name: 'Lunch' }),
  category('bread', { parentId: 'food', name: 'Bread' }),
  category('salary', { type: 'income' }),
];

describe('buildTree', () => {
  it("puts each parent's subcategories under it, by sortOrder then name", () => {
    expect(buildTree(categories, 'expense').map(({ category: parent, children }) => [parent.id, children.map((c) => c.id)])).toEqual([
      ['rent', []],
      ['food', ['bread', 'lunch']],
    ]);
  });

  it('lifts a subcategory whose parent is not in the list to the top level', () => {
    expect(buildTree([category('orphan', { parentId: 'archived' })], 'expense').map(({ category: c }) => c.id)).toEqual(['orphan']);
  });
});

describe('move', () => {
  it('takes the item out and puts it back where it landed', () => {
    expect(move(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(move(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('leaves the list it was given alone', () => {
    const items = ['a', 'b'];
    expect(move(items, 0, 1)).toEqual(['b', 'a']);
    expect(items).toEqual(['a', 'b']);
  });
});

describe('moveSubcategory', () => {
  it("moves one parent's subcategories and leaves the other parents as they were", () => {
    const tree = buildTree(categories, 'expense');
    const moved = moveSubcategory(tree, 'food', 1, 0);
    expect(orderedIds(moved)).toEqual(['rent', 'food', 'lunch', 'bread']);
    expect(moved[0]).toBe(tree[0]);
  });
});

describe('orderedIds', () => {
  it('reads the tree as the list shows it: each parent, then its own subcategories', () => {
    expect(orderedIds(buildTree(categories, 'expense'))).toEqual(['rent', 'food', 'bread', 'lunch']);
  });
});
