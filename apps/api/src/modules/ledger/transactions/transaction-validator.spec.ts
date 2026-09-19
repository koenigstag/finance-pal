import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ObjectLiteral, Repository } from 'typeorm';
import { TransactionType, type Account, type Category } from '@ft/api-database';
import {
  TransactionValidator,
  keptPercentage,
  keptPercentageAsOf,
  keptPercentageBase,
  keptRoundBalanceTo,
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
  roundBalanceTo: null,
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

  it('takes nothing for an amount only for an estimate from the balance', async () => {
    const zero = (fields: Partial<TransactionShape>, estimate: boolean) =>
      validator.validate(GROUP, { ...expense('food'), amount: '0.00', ...fields }, { estimate });
    await expect(zero({ roundBalanceTo: 100 }, true)).resolves.toEqual({ categoryId: 'food', subcategoryId: null });
    await expect(zero({ percentage: '3' }, true)).resolves.toEqual({ categoryId: 'food', subcategoryId: null });
    // Recorded, it moves no money; a base amount isn't a balance; a typed amount is no estimate.
    await expect(zero({ roundBalanceTo: 100 }, false)).rejects.toThrow(BadRequestException);
    await expect(zero({ percentage: '3', percentageBase: '1000.00' }, true)).rejects.toThrow(BadRequestException);
    await expect(zero({}, true)).rejects.toThrow(BadRequestException);
  });

  it('rounds the balance to one of the steps, and never beside a percentage', async () => {
    const rounding = (roundBalanceTo: number, percentage: string | null = null) =>
      validator.validate(GROUP, { ...expense('food'), roundBalanceTo, percentage });
    await expect(rounding(100)).resolves.toEqual({ categoryId: 'food', subcategoryId: null });
    await expect(rounding(50)).rejects.toThrow(BadRequestException);
    await expect(rounding(10, '5')).rejects.toThrow(BadRequestException);
  });
});

describe('keptPercentage and keptRoundBalanceTo', () => {
  const percentage = { percentage: '5', roundBalanceTo: null };
  const rounding = { percentage: null, roundBalanceTo: 100 };

  it('keep what an update leaves out', () => {
    expect(keptPercentage({}, percentage)).toBe('5');
    expect(keptRoundBalanceTo({}, rounding)).toBe(100);
  });

  it('drop one when an update names the other', () => {
    expect(keptPercentage({ roundBalanceTo: 10 }, percentage)).toBeNull();
    expect(keptRoundBalanceTo({ percentage: '3' }, rounding)).toBeNull();
    // Clearing one leaves the other as it was.
    expect(keptRoundBalanceTo({ percentage: null }, rounding)).toBe(100);
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
  // Worked out on its date: recorded, no estimate.
  const recorded = { date: taken, percentage: '3.5000', roundBalanceTo: null, accountId: 'card', percentageAsOf: taken };
  // Worked out on the 10th for October: an estimate.
  const estimate = { ...recorded, date: planned };
  const merged = { percentage: '3.5', percentageBase: null, roundBalanceTo: null, accountId: 'card' };

  it('is now for a new or changed way of working the amount out, or another account', () => {
    expect(keptPercentageAsOf(null, merged, planned, now)).toBe(now);
    expect(keptPercentageAsOf(null, merged, now, now)).toBe(now);
    expect(keptPercentageAsOf(estimate, { ...merged, percentage: '4' }, planned, now)).toBe(now);
    expect(keptPercentageAsOf(estimate, { ...merged, percentage: null, roundBalanceTo: 100 }, planned, now)).toBe(now);
    expect(keptPercentageAsOf(estimate, { ...merged, accountId: 'wallet' }, planned, now)).toBe(now);
  });

  it('keeps an estimate one, moved to another day ahead or brought to today', () => {
    expect(keptPercentageAsOf(estimate, merged, planned, now)).toBe(taken);
    expect(keptPercentageAsOf(estimate, merged, new Date('2026-11-01T12:00:00Z'), now)).toBe(taken);
    // "Add now": still worked out before its date, so it lands and is worked out a last time.
    expect(keptPercentageAsOf(estimate, merged, now, now)).toBe(taken);
  });

  it('lets a recorded amount stand, moved to another day already past', () => {
    expect(keptPercentageAsOf(recorded, merged, taken, now)).toBe(taken);
    expect(keptPercentageAsOf(recorded, merged, new Date('2026-09-05T12:00:00Z'), now)).toBe(taken);
    // Later than when it was worked out, but past: that makes it no estimate.
    expect(keptPercentageAsOf(recorded, merged, new Date('2026-09-15T12:00:00Z'), now)).toBe(now);
    // Moved ahead, it becomes one.
    expect(keptPercentageAsOf(recorded, merged, planned, now)).toBe(taken);
  });

  it('works the same for a rounding of the balance', () => {
    const rounded = { ...estimate, percentage: null, roundBalanceTo: 100 };
    const roundedMerged = { ...merged, percentage: null, roundBalanceTo: 100 };
    expect(keptPercentageAsOf(rounded, roundedMerged, planned, now)).toBe(taken);
    expect(keptPercentageAsOf(rounded, { ...roundedMerged, roundBalanceTo: 10 }, planned, now)).toBe(now);
  });

  it('has none for a fixed amount or a percentage of a base amount', () => {
    expect(keptPercentageAsOf(estimate, { ...merged, percentage: null }, planned, now)).toBeNull();
    expect(keptPercentageAsOf(estimate, { ...merged, percentageBase: '1000.00' }, planned, now)).toBeNull();
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
