import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ObjectLiteral, Repository } from 'typeorm';
import { TransactionType, type Account, type Category } from '@ft/api-database';
import {
  TransactionValidator,
  keptPercentageAsOf,
  keptPercentageBase,
  keptSubcategory,
  type TransactionShape,
} from './transaction-validator';

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
  percentage: null,
  percentageBase: null,
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

  it('takes a percentage above 0 and up to 100', async () => {
    const withPercentage = (percentage: string) => validator.validate(GROUP, { ...expense('food'), percentage });
    await expect(withPercentage('0.0125')).resolves.toEqual({ categoryId: 'food', subcategoryId: null });
    await expect(withPercentage('100')).resolves.toEqual({ categoryId: 'food', subcategoryId: null });
    await expect(withPercentage('0')).rejects.toThrow(BadRequestException);
    await expect(withPercentage('100.5')).rejects.toThrow(BadRequestException);
  });

  it('takes a base amount above zero, and only beside a percentage', async () => {
    const withBase = (percentage: string | null, percentageBase: string) =>
      validator.validate(GROUP, { ...expense('food'), percentage, percentageBase });
    await expect(withBase('5', '12000.00')).resolves.toEqual({ categoryId: 'food', subcategoryId: null });
    await expect(withBase('5', '0.00')).rejects.toThrow(BadRequestException);
    await expect(withBase(null, '12000.00')).rejects.toThrow(BadRequestException);
  });
});

describe('keptPercentageBase', () => {
  const existing = { percentageBase: '12000.00' };

  it('keeps the base amount while there is a percentage', () => {
    expect(keptPercentageBase({}, existing, '5')).toBe('12000.00');
  });

  it('drops it along with the percentage', () => {
    expect(keptPercentageBase({}, existing, null)).toBeNull();
  });

  it('takes the one an update names', () => {
    expect(keptPercentageBase({ percentageBase: null }, existing, '5')).toBeNull();
    expect(keptPercentageBase({ percentageBase: '500.00' }, existing, '5')).toBe('500.00');
  });
});

describe('keptPercentageAsOf', () => {
  const now = new Date('2026-09-18T12:00:00Z');
  const taken = new Date('2026-09-10T09:00:00Z');
  const planned = new Date('2026-10-01T12:00:00Z');
  const existing = { percentage: '3.5000', accountId: 'card', percentageAsOf: taken };
  const merged = { percentage: '3.5', percentageBase: null, accountId: 'card' };

  it('takes a new percentage of the balance as of now', () => {
    expect(keptPercentageAsOf(null, merged, planned, now)).toBe(now);
    expect(keptPercentageAsOf(null, merged, now, now)).toBe(now);
    expect(keptPercentageAsOf(existing, { ...merged, percentage: '4' }, planned, now)).toBe(now);
    expect(keptPercentageAsOf(existing, { ...merged, accountId: 'wallet' }, planned, now)).toBe(now);
  });

  it('keeps the moment it had while neither the percentage nor the account changed', () => {
    expect(keptPercentageAsOf(existing, merged, planned, now)).toBe(taken);
    expect(keptPercentageAsOf(existing, merged, new Date('2026-09-05T12:00:00Z'), now)).toBe(taken);
  });

  it('lets an amount dated in the past stand, rather than work it out again', () => {
    // Moved to a later day that has passed already: the balance was taken before it, but that
    // makes it no estimate.
    expect(keptPercentageAsOf(existing, merged, new Date('2026-09-15T12:00:00Z'), now)).toBe(now);
  });

  it('has none for a fixed amount or a percentage of a base amount', () => {
    expect(keptPercentageAsOf(existing, { ...merged, percentage: null }, planned, now)).toBeNull();
    expect(keptPercentageAsOf(existing, { ...merged, percentageBase: '1000.00' }, planned, now)).toBeNull();
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
