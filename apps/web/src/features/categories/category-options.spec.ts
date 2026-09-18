import { describe, expect, it } from 'vitest';
import { categoriesUnder, categoryOptions, type Category } from './queries';

const category = (id: string, overrides: Partial<Category>): Category => ({
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

describe('categoryOptions', () => {
  it('orders parents before their children, by sortOrder then name', () => {
    const options = categoryOptions(
      [
        category('food', { sortOrder: 2 }),
        category('rent', { sortOrder: 1 }),
        category('lunch', { parentId: 'food', name: 'Lunch' }),
        category('bread', { parentId: 'food', name: 'Bread' }),
        category('salary', { type: 'income' }),
      ],
      'expense',
    );
    expect(options.map(({ category: c, depth }) => `${c.id}:${depth}`)).toEqual(['rent:0', 'food:0', 'bread:1', 'lunch:1']);
  });

  it('lifts a child whose parent is missing to the top level', () => {
    const options = categoryOptions([category('orphan', { parentId: 'gone' })], 'expense');
    expect(options).toEqual([{ category: expect.objectContaining({ id: 'orphan' }), depth: 0 }]);
  });
});

describe('categoriesUnder', () => {
  const categories = [
    category('food', { sortOrder: 2 }),
    category('rent', { sortOrder: 1 }),
    category('lunch', { parentId: 'food', name: 'Lunch' }),
    category('bread', { parentId: 'food', name: 'Bread' }),
    category('salary', { type: 'income' }),
  ];

  it('lists one level of one type, by sortOrder then name', () => {
    expect(categoriesUnder(categories, 'expense', null).map((c) => c.id)).toEqual(['rent', 'food']);
    expect(categoriesUnder(categories, 'expense', 'food').map((c) => c.id)).toEqual(['bread', 'lunch']);
    expect(categoriesUnder(categories, 'income', null).map((c) => c.id)).toEqual(['salary']);
  });
});
