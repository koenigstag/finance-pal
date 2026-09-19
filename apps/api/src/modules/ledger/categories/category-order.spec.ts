import { sortOrderChanges, type OrderedCategory } from './category-order';

const category = (id: string, overrides: Partial<OrderedCategory> = {}): OrderedCategory => ({
  id,
  type: 'expense',
  parentId: null,
  sortOrder: 0,
  ...overrides,
});

describe('sortOrderChanges', () => {
  it('numbers a level from 0, in the order given', () => {
    expect(sortOrderChanges([category('rent'), category('food'), category('fun')])).toEqual([
      { id: 'food', sortOrder: 1 },
      { id: 'fun', sortOrder: 2 },
    ]);
  });

  it('counts each level apart: a type, and the subcategories under each parent', () => {
    const changes = sortOrderChanges([
      category('food', { sortOrder: 9 }),
      category('bread', { parentId: 'food', sortOrder: 9 }),
      category('lunch', { parentId: 'food', sortOrder: 9 }),
      category('rent', { sortOrder: 9 }),
      category('salary', { type: 'income', sortOrder: 9 }),
    ]);
    expect(changes).toEqual([
      { id: 'food', sortOrder: 0 },
      { id: 'bread', sortOrder: 0 },
      { id: 'lunch', sortOrder: 1 },
      { id: 'rent', sortOrder: 1 },
      { id: 'salary', sortOrder: 0 },
    ]);
  });

  it('leaves out the categories that are already where the order puts them', () => {
    const ordered = [category('rent'), category('food', { sortOrder: 1 })];
    expect(sortOrderChanges(ordered)).toEqual([]);
  });
});
