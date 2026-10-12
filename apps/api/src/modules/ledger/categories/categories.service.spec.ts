import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Budget, Category, CategoryRule, Currency, RecurringRule, Transaction } from '@ft/api-database';
import { defineAbilityFor } from '@ft/shared-contracts';
import type { AbilityFactory } from '../../_core/authz/ability.factory';
import type { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';
import { CategoriesService } from './categories.service';

// The decorator wants a registered data source; these tests have none, and nothing here depends on
// a real transaction.
jest.mock('typeorm-transactional', () => ({ Transactional: () => () => undefined }));

const GROUP = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const UAH = 3;
const USD = 2;
const EUR = 1;

const category = (fields: Partial<Category> & Pick<Category, 'id'>): Category =>
  ({ groupId: GROUP, type: 'expense', name: fields.id, parentId: null, currencyId: null, ...fields }) as Category;

/**
 * A service over these categories, `used` being the ones with transactions filed under them (a
 * subcategory's are filed under its parent too, as in the table).
 */
function makeService(rows: Category[], used: string[] = []) {
  const matches = (row: Category, where: Partial<Category>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof Category] === value);
  const categories = {
    findOneBy: async (where: Partial<Category>) => rows.find((row) => matches(row, where)) ?? null,
    exists: async ({ where }: { where: Partial<Category> }) => rows.some((row) => matches(row, where)),
    create: (input: Partial<Category>) => ({ ...input, id: 'new' }) as Category,
    save: async (input: Category) => {
      rows.push(input);
      return input;
    },
    update: async (where: Partial<Category>, changes: Partial<Category>) => {
      rows.filter((row) => matches(row, where)).forEach((row) => Object.assign(row, changes));
    },
  } as unknown as Repository<Category>;

  // Whatever names the category, in either column.
  let asked: string | undefined;
  const query = {
    where: () => query,
    andWhere: (_sql: string, values: { categoryId: string }) => {
      asked = values.categoryId;
      return query;
    },
    getExists: async () => {
      const target = rows.find((row) => row.id === asked);
      return used.includes(asked as string) || (target?.parentId === null && rows.some((row) => row.parentId === asked && used.includes(row.id)));
    },
  };
  const transactions = { createQueryBuilder: () => query, update: async () => undefined } as unknown as Repository<Transaction>;
  const recurringRules = { update: async () => undefined } as unknown as Repository<RecurringRule>;
  const budgets = { delete: async () => undefined } as unknown as Repository<Budget>;
  const currencies = {
    existsBy: async ({ id }: { id: number }) => [UAH, USD, EUR].includes(id),
  } as unknown as Repository<Currency>;
  const abilities = {
    forGroup: async () => ({ ability: defineAbilityFor({ role: 'member', archived: false }), groupName: 'Home' }),
  } as unknown as AbilityFactory;
  const realtime = { emitToGroup: jest.fn() } as unknown as RealtimeEmitterService;

  const service = new CategoriesService(
    categories,
    transactions,
    recurringRules,
    {} as Repository<CategoryRule>,
    budgets,
    currencies,
    abilities,
    realtime,
  );
  const stored = (id: string) => rows.find((row) => row.id === id)?.currencyId;
  return { service, stored };
}

describe('CategoriesService: a new category’s currency', () => {
  it('gives a top-level category the one asked for, or none', async () => {
    const { service } = makeService([]);
    await expect(service.create(USER, GROUP, { type: 'expense', name: 'Subscriptions', currencyId: USD })).resolves.toMatchObject({
      currencyId: USD,
    });
    await expect(service.create(USER, GROUP, { type: 'expense', name: 'Food' })).resolves.toMatchObject({ currencyId: null });
  });

  it('refuses one for a subcategory, and a currency the app doesn’t have', async () => {
    const { service } = makeService([category({ id: 'food', currencyId: UAH })]);
    await expect(service.create(USER, GROUP, { type: 'expense', name: 'Bakery', parentId: 'food', currencyId: UAH })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.create(USER, GROUP, { type: 'expense', name: 'Food', currencyId: 999 })).rejects.toThrow(BadRequestException);
  });
});

describe('CategoriesService: changing a category’s currency', () => {
  it('changes freely while nothing is filed under the category', async () => {
    const { service, stored } = makeService([category({ id: 'food', currencyId: UAH })]);
    await service.update(USER, GROUP, 'food', { currencyId: USD });
    expect(stored('food')).toBe(USD);
    await service.update(USER, GROUP, 'food', { currencyId: null });
    expect(stored('food')).toBeNull();
  });

  it('stays once there are transactions in it, its subcategories’ included', async () => {
    const { service, stored } = makeService(
      [category({ id: 'food', currencyId: UAH }), category({ id: 'bakery', parentId: 'food' })],
      ['bakery'],
    );
    await expect(service.update(USER, GROUP, 'food', { currencyId: USD })).rejects.toThrow(
      'The currency of a category with transactions cannot be changed',
    );
    await expect(service.update(USER, GROUP, 'food', { currencyId: null })).rejects.toThrow(BadRequestException);
    // Naming the one it has, or none at all, is no change.
    await service.update(USER, GROUP, 'food', { name: 'Groceries', currencyId: UAH });
    await service.update(USER, GROUP, 'food', { name: 'Food' });
    expect(stored('food')).toBe(UAH);
  });

  it('can be set on a category that has none, transactions or not', async () => {
    const { service, stored } = makeService([category({ id: 'food' })], ['food']);
    await service.update(USER, GROUP, 'food', { currencyId: EUR });
    expect(stored('food')).toBe(EUR);
  });

  it('refuses one for a subcategory, which is in its parent’s', async () => {
    const { service } = makeService([category({ id: 'food', currencyId: UAH }), category({ id: 'bakery', parentId: 'food' })]);
    await expect(service.update(USER, GROUP, 'bakery', { currencyId: USD })).rejects.toThrow(BadRequestException);
  });
});

describe('CategoriesService: moving a category between parents', () => {
  const tree = () => [
    category({ id: 'food', currencyId: UAH }),
    category({ id: 'abroad', currencyId: USD }),
    category({ id: 'hryvnias', currencyId: UAH }),
    category({ id: 'subscriptions', currencyId: USD }),
    category({ id: 'bakery', parentId: 'food' }),
  ];

  it('takes a category with transactions only under a parent in its own currency', async () => {
    const { service, stored } = makeService(tree(), ['subscriptions']);
    await expect(service.update(USER, GROUP, 'subscriptions', { parentId: 'food' })).rejects.toThrow(
      'A category with transactions cannot move under a category in another currency',
    );
    await service.update(USER, GROUP, 'subscriptions', { parentId: 'abroad' });
    // A subcategory keeps none of its own.
    expect(stored('subscriptions')).toBeNull();
  });

  it('keeps a subcategory in its parent’s currency as it comes out to the top level', async () => {
    const { service, stored } = makeService(tree(), ['bakery']);
    await service.update(USER, GROUP, 'bakery', { parentId: null });
    expect(stored('bakery')).toBe(UAH);
  });

  it('moves one with transactions to another parent in the same currency', async () => {
    const { service } = makeService(tree(), ['bakery']);
    await expect(service.update(USER, GROUP, 'bakery', { parentId: 'abroad' })).rejects.toThrow(BadRequestException);
    await expect(service.update(USER, GROUP, 'bakery', { parentId: 'hryvnias' })).resolves.toMatchObject({ parentId: 'hryvnias' });
  });
});
