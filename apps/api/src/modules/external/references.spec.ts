import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  favouriteAccount,
  findAccount,
  named,
  resolveCategoryPair,
  transferDestAmount,
  type AccountLike,
  type CategoryLike,
} from './references';

const account = (id: string, name: string, extra: Partial<AccountLike> = {}): AccountLike => ({
  id,
  name,
  archived: false,
  isFavourite: false,
  currencyId: 1,
  ...extra,
});

const category = (id: string, name: string, extra: Partial<CategoryLike> = {}): CategoryLike => ({
  id,
  name,
  archived: false,
  type: 'expense',
  parentId: null,
  ...extra,
});

describe('named', () => {
  it('ignores case, surrounding spaces and how accents are encoded', () => {
    const items = [account('a', 'Café Card')];
    expect(named(items, '  café card ')).toHaveLength(1);
    // "é" written as "e" plus a combining accent.
    expect(named(items, 'cafe\u0301 card')).toHaveLength(1);
  });

  it('prefers active items over archived ones of the same name', () => {
    const items = [account('old', 'Mono', { archived: true }), account('new', 'Mono')];
    expect(named(items, 'mono').map((item) => item.id)).toEqual(['new']);
  });

  it('falls back to archived items when no active one has the name', () => {
    expect(named([account('old', 'Mono', { archived: true })], 'Mono')).toHaveLength(1);
  });
});

describe('findAccount', () => {
  const accounts = [account('a1', 'Cash'), account('a2', 'Mono'), account('a3', 'Card'), account('a4', 'card')];

  it('finds by id or by name', () => {
    expect(findAccount(accounts, 'a2', undefined, 'account')?.id).toBe('a2');
    expect(findAccount(accounts, undefined, 'cash', 'account')?.id).toBe('a1');
    expect(findAccount(accounts, undefined, undefined, 'account')).toBeUndefined();
  });

  it('refuses an id and a name together', () => {
    expect(() => findAccount(accounts, 'a1', 'Cash', 'account')).toThrow(BadRequestException);
  });

  it('tells a missing account from an ambiguous name', () => {
    expect(() => findAccount(accounts, 'nope', undefined, 'toAccount')).toThrow(NotFoundException);
    expect(() => findAccount(accounts, undefined, 'Wallet', 'account')).toThrow(NotFoundException);
    expect(() => findAccount(accounts, undefined, 'CARD', 'account')).toThrow(/send accountId/);
  });
});

describe('favouriteAccount', () => {
  it('is the active favourite', () => {
    expect(favouriteAccount([account('a', 'A'), account('b', 'B', { isFavourite: true })]).id).toBe('b');
  });

  it('is required when a request names no account', () => {
    expect(() => favouriteAccount([account('a', 'A', { isFavourite: true, archived: true })])).toThrow(BadRequestException);
  });
});

describe('transferDestAmount', () => {
  const uah = account('u', 'UAH card', { currencyId: 1 });
  const uah2 = account('u2', 'UAH cash', { currencyId: 1 });
  const usd = account('d', 'USD card', { currencyId: 2 });

  it('is null within one currency, and refused there', () => {
    expect(transferDestAmount(uah, uah2, undefined)).toBeNull();
    expect(() => transferDestAmount(uah, uah2, '10')).toThrow(BadRequestException);
  });

  it('takes a figure named across currencies as it is', () => {
    expect(transferDestAmount(uah, usd, '25')).toBe('25');
  });

  it('leaves an unnamed one across currencies to be converted at the rate', () => {
    expect(transferDestAmount(uah, usd, undefined)).toBeNull();
  });
});

describe('resolveCategoryPair', () => {
  const food = category('food', 'Food');
  const transport = category('transport', 'Transport');
  const taxi = category('taxi', 'Taxi', { parentId: 'transport' });
  const cafe = category('cafe', 'Cafe', { parentId: 'food' });
  const foodOther = category('food-other', 'Other', { parentId: 'food' });
  const transportOther = category('transport-other', 'Other', { parentId: 'transport' });
  const salary = category('salary', 'Salary', { type: 'income' });
  const categories = [food, transport, taxi, cafe, foodOther, transportOther, salary];

  it('names nothing when the request names nothing', () => {
    expect(resolveCategoryPair(categories, 'expense', {})).toEqual({});
  });

  it('resolves a top-level category by name', () => {
    expect(resolveCategoryPair(categories, 'expense', { categoryName: 'food' })).toEqual({ categoryId: 'food' });
  });

  it('files a subcategory named as the category under its parent', () => {
    expect(resolveCategoryPair(categories, 'expense', { categoryName: 'Taxi' })).toEqual({
      categoryId: 'transport',
      subcategoryId: 'taxi',
    });
    expect(resolveCategoryPair(categories, 'expense', { categoryId: 'taxi' })).toEqual({
      categoryId: 'transport',
      subcategoryId: 'taxi',
    });
  });

  it('finds a subcategory named alone, with its parent', () => {
    expect(resolveCategoryPair(categories, 'expense', { subcategoryName: 'cafe' })).toEqual({
      categoryId: 'food',
      subcategoryId: 'cafe',
    });
  });

  it('needs the category for a subcategory name several categories use', () => {
    expect(() => resolveCategoryPair(categories, 'expense', { subcategoryName: 'Other' })).toThrow(/send its category too/);
    expect(resolveCategoryPair(categories, 'expense', { categoryName: 'Transport', subcategoryName: 'Other' })).toEqual({
      categoryId: 'transport',
      subcategoryId: 'transport-other',
    });
  });

  it("looks under an update's current category first", () => {
    expect(resolveCategoryPair(categories, 'expense', { subcategoryName: 'Other' }, 'food')).toEqual({
      categoryId: 'food',
      subcategoryId: 'food-other',
    });
  });

  it("refuses a subcategory of another category", () => {
    expect(() => resolveCategoryPair(categories, 'expense', { categoryName: 'Food', subcategoryName: 'Taxi' })).toThrow(
      NotFoundException,
    );
    expect(() => resolveCategoryPair(categories, 'expense', { categoryId: 'food', subcategoryId: 'taxi' })).toThrow(
      /isn't a subcategory of "Food"/,
    );
  });

  it('refuses a category of the other type', () => {
    expect(() => resolveCategoryPair(categories, 'income', { categoryId: 'food' })).toThrow(/an expense category/);
    expect(() => resolveCategoryPair(categories, 'income', { categoryName: 'Food' })).toThrow(NotFoundException);
  });

  it('refuses categories on a transfer, but lets them be cleared', () => {
    expect(() => resolveCategoryPair(categories, 'transfer', { categoryName: 'Food' })).toThrow(/A transfer has no category/);
    expect(resolveCategoryPair(categories, 'transfer', { categoryId: null })).toEqual({});
  });

  it('clears on null', () => {
    expect(resolveCategoryPair(categories, 'expense', { categoryId: null })).toEqual({ categoryId: null, subcategoryId: null });
    expect(resolveCategoryPair(categories, 'expense', { subcategoryId: null })).toEqual({ subcategoryId: null });
    expect(() => resolveCategoryPair(categories, 'expense', { categoryId: null, subcategoryName: 'Taxi' })).toThrow(
      BadRequestException,
    );
  });

  it('refuses a category given as a subcategory', () => {
    expect(() => resolveCategoryPair(categories, 'expense', { subcategoryId: 'food' })).toThrow(/is a category, not a subcategory/);
  });
});
