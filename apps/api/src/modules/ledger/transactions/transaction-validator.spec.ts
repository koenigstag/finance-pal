import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ObjectLiteral, Repository } from 'typeorm';
import { TransactionType, type Account, type Category } from '@ft/api-database';
import { TransactionValidator, keptSubcategory, type TransactionShape } from './transaction-validator';

// The real module builds its DataSource from DATABASE_URL the moment it's imported. The validator
// only needs the entity classes as injection tokens, and the enum's values as enums.ts has them.
jest.mock('@ft/api-database', () => ({
  Account: class Account {},
  Category: class Category {},
  TransactionType: { EXPENSE: 'expense', INCOME: 'income', TRANSFER: 'transfer' },
}));

const GROUP = 'group';

interface Row {
  id: string;
  groupId: string;
  parentId?: string | null;
}

// Just what the validator reads: one row by id within a group.
function repository<T extends ObjectLiteral>(rows: Row[]): Repository<T> {
  const findOneBy = async ({ id, groupId }: Row) => rows.find((row) => row.id === id && row.groupId === groupId) ?? null;
  return { findOneBy } as unknown as Repository<T>;
}

const validator = new TransactionValidator(
  repository<Account>([{ id: 'cash', groupId: GROUP }]),
  repository<Category>([
    { id: 'transport', groupId: GROUP, parentId: null },
    { id: 'taxi', groupId: GROUP, parentId: 'transport' },
    { id: 'food', groupId: GROUP, parentId: null },
    { id: 'elsewhere', groupId: 'another group', parentId: null },
  ]),
);

const expense = (categoryId: string | null, subcategoryId: string | null = null): TransactionShape => ({
  type: TransactionType.EXPENSE,
  accountId: 'cash',
  categoryId,
  subcategoryId,
  toAccountId: null,
  amount: '10.00',
  destAmount: null,
});

describe('TransactionValidator', () => {
  it('files a transaction under a category and one of its subcategories', async () => {
    await expect(validator.validate(GROUP, expense('transport', 'taxi'))).resolves.toEqual({
      categoryId: 'transport',
      subcategoryId: 'taxi',
    });
    await expect(validator.validate(GROUP, expense('food'))).resolves.toEqual({ categoryId: 'food', subcategoryId: null });
  });

  it('reads a subcategory sent as the category as that subcategory under its parent', async () => {
    // What a client from before subcategoryId sends when a subcategory is picked.
    await expect(validator.validate(GROUP, expense('taxi'))).resolves.toEqual({
      categoryId: 'transport',
      subcategoryId: 'taxi',
    });
  });

  it('refuses a subcategory that is not one of the category’s own', async () => {
    await expect(validator.validate(GROUP, expense('food', 'taxi'))).rejects.toThrow(BadRequestException);
    // A subcategory in the category's place, with a different one beside it.
    await expect(validator.validate(GROUP, expense('taxi', 'food'))).rejects.toThrow(BadRequestException);
  });

  it('refuses a subcategory without a category', async () => {
    await expect(validator.validate(GROUP, expense(null, 'taxi'))).rejects.toThrow(BadRequestException);
  });

  it('refuses a category or subcategory from another group', async () => {
    await expect(validator.validate(GROUP, expense('elsewhere'))).rejects.toThrow(NotFoundException);
    await expect(validator.validate(GROUP, expense('transport', 'elsewhere'))).rejects.toThrow(NotFoundException);
  });

  it('refuses a subcategory on a transfer', async () => {
    const transfer = { ...expense(null, 'taxi'), type: TransactionType.TRANSFER, toAccountId: 'cash' };
    await expect(validator.validate(GROUP, transfer)).rejects.toThrow(BadRequestException);
  });
});

describe('keptSubcategory', () => {
  const existing = { categoryId: 'transport', subcategoryId: 'taxi' };

  it('keeps the subcategory while the category stays', () => {
    expect(keptSubcategory({}, existing, 'transport')).toBe('taxi');
  });

  it('drops it when the category changes, since it belonged to the old one', () => {
    expect(keptSubcategory({}, existing, 'food')).toBeNull();
  });

  it('takes the one an update names', () => {
    expect(keptSubcategory({ subcategoryId: null }, existing, 'transport')).toBeNull();
  });
});
