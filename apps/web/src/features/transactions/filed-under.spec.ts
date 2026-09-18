import { describe, expect, it } from 'vitest';
import type { Category } from '@/features/categories/queries';
import { filedUnder } from './filed-under';

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

const categories = new Map(
  [
    category('transport', { name: 'Transport', icon: 'bus', color: '#FFAB40' }),
    category('taxi', { name: 'Taxi', parentId: 'transport', icon: 'car' }),
    category('tram', { name: 'Tram', parentId: 'transport' }),
  ].map((item) => [item.id, item]),
);
const find = (id: string) => categories.get(id);

describe('filedUnder', () => {
  it('names the category alone when there is no subcategory', () => {
    expect(filedUnder({ categoryId: 'transport', subcategoryId: null }, find)).toEqual({
      name: 'Transport',
      icon: 'bus',
      color: '#FFAB40',
    });
  });

  it('adds the subcategory, taking its look where it has its own', () => {
    expect(filedUnder({ categoryId: 'transport', subcategoryId: 'taxi' }, find)).toEqual({
      name: 'Transport › Taxi',
      icon: 'car',
      color: '#FFAB40',
    });
    expect(filedUnder({ categoryId: 'transport', subcategoryId: 'tram' }, find)?.icon).toBe('bus');
  });

  it('is undefined without a category, or when none of it is known', () => {
    expect(filedUnder({ categoryId: null, subcategoryId: null }, find)).toBeUndefined();
    expect(filedUnder({ categoryId: 'archived', subcategoryId: null }, find)).toBeUndefined();
  });
});
