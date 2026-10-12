import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Account, Budget, Category, Profile } from '@ft/api-database';
import { defineAbilityFor, type MemberRole } from '@ft/shared-contracts';
import type { AbilityFactory } from '../../_core/authz/ability.factory';
import type { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';
import { BudgetsService } from './budgets.service';

// The decorator wants a registered data source; these tests have none, and nothing here depends on
// a real transaction.
jest.mock('typeorm-transactional', () => ({ Transactional: () => () => undefined }));

const GROUP = '00000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000002';
const UAH = 3;
const USD = 2;

const groceries = { id: 'cat-groceries', groupId: GROUP, name: 'Groceries', parentId: null, archived: false } as Category;
const bakery = { id: 'cat-bakery', groupId: GROUP, name: 'Bakery', parentId: groceries.id, archived: false } as Category;
const oldHobby = { id: 'cat-hobby', groupId: GROUP, name: 'Hobby', parentId: null, archived: true } as Category;
const piggyBank = { id: 'acc-piggy', groupId: GROUP, name: 'Piggy bank', type: 'savings', currencyId: USD, archived: false } as Account;
const card = { id: 'acc-card', groupId: GROUP, name: 'Card', type: 'regular', currencyId: UAH, archived: false } as Account;

interface Fakes {
  service: BudgetsService;
  rows: Budget[];
  emit: jest.Mock;
}

function makeService({ role = 'member' as MemberRole, rows = [] as Budget[], profile = true } = {}): Fakes {
  const matches = (row: Budget, where: Partial<Budget>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof Budget] === value);
  const budgets = {
    exists: async ({ where }: { where: Partial<Budget> }) => rows.some((row) => matches(row, where)),
    findOneBy: async (where: Partial<Budget>) => rows.find((row) => matches(row, where)) ?? null,
    create: (input: Partial<Budget>) => input as Budget,
    save: async (input: Budget) => {
      const saved = { ...input, id: `budget-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date() };
      rows.push(saved);
      return saved;
    },
    update: async (where: Partial<Budget>, changes: Partial<Budget>) => {
      rows.filter((row) => matches(row, where)).forEach((row) => Object.assign(row, changes));
    },
  } as unknown as Repository<Budget>;
  const byId = <T extends { id: string }>(items: T[]) =>
    ({ findOneBy: async ({ id }: { id: string }) => items.find((item) => item.id === id) ?? null }) as unknown as Repository<T>;
  const profiles = {
    findOneBy: async () => (profile ? ({ id: USER, mainCurrencyId: UAH } as Profile) : null),
  } as unknown as Repository<Profile>;
  const abilities = {
    forGroup: async () => ({ ability: defineAbilityFor({ role, archived: false }), groupName: 'Home' }),
  } as unknown as AbilityFactory;
  const emit = jest.fn();
  const realtime = { emitToGroup: emit } as unknown as RealtimeEmitterService;

  const service = new BudgetsService(
    budgets,
    byId([groceries, bakery, oldHobby]),
    byId([piggyBank, card]),
    profiles,
    abilities,
    realtime,
  );
  return { service, rows, emit };
}

describe('BudgetsService.create', () => {
  it("puts a category's amount in the main currency of whoever set it", async () => {
    const { service, rows, emit } = makeService();
    const budget = await service.create(USER, GROUP, { month: '2026-10', categoryId: groceries.id, amount: '15000' });
    expect(budget).toMatchObject({ month: '2026-10-01', categoryId: groceries.id, accountId: null, currencyId: UAH });
    expect(rows).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith(GROUP, expect.objectContaining({ resourceType: 'Budget', action: 'created' }));
  });

  it("puts an account's amount in the account's currency", async () => {
    const { service } = makeService();
    const budget = await service.create(USER, GROUP, { month: '2026-10', accountId: piggyBank.id, amount: '200' });
    expect(budget).toMatchObject({ accountId: piggyBank.id, categoryId: null, currencyId: USD });
  });

  it('refuses a second amount for the same category in a month, but not in another month', async () => {
    const { service } = makeService();
    await service.create(USER, GROUP, { month: '2026-10', categoryId: groceries.id, amount: '15000' });
    await expect(service.create(USER, GROUP, { month: '2026-10', categoryId: groceries.id, amount: '1' })).rejects.toThrow(
      ConflictException,
    );
    await expect(service.create(USER, GROUP, { month: '2026-11', categoryId: groceries.id, amount: '1' })).resolves.toBeDefined();
  });

  it.each([
    ['a subcategory', { categoryId: bakery.id }, BadRequestException],
    ['an archived category', { categoryId: oldHobby.id }, BadRequestException],
    ['a regular account', { accountId: card.id }, BadRequestException],
    ['both a category and an account', { categoryId: groceries.id, accountId: piggyBank.id }, BadRequestException],
    ['neither', {}, BadRequestException],
    ['an unknown category', { categoryId: 'cat-missing' }, NotFoundException],
    ['an amount of zero', { categoryId: groceries.id, amount: '0' }, BadRequestException],
  ])('refuses %s', async (_name, target, error) => {
    const { service, rows } = makeService();
    await expect(service.create(USER, GROUP, { month: '2026-10', amount: '100', ...target })).rejects.toThrow(error);
    expect(rows).toHaveLength(0);
  });

  it("refuses a viewer", async () => {
    const { service } = makeService({ role: 'viewer' });
    await expect(service.create(USER, GROUP, { month: '2026-10', categoryId: groceries.id, amount: '1' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('needs a profile to know the main currency', async () => {
    const { service } = makeService({ profile: false });
    await expect(service.create(USER, GROUP, { month: '2026-10', categoryId: groceries.id, amount: '1' })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('BudgetsService.update', () => {
  const line = (overrides: Partial<Budget>) =>
    ({ id: 'budget-1', groupId: GROUP, month: '2026-10-01', amount: '100', createdAt: new Date(), updatedAt: new Date(), ...overrides }) as Budget;

  it("moves a category's amount into the editor's main currency", async () => {
    const { service } = makeService({ rows: [line({ categoryId: groceries.id, accountId: null, currencyId: USD })] });
    await expect(service.update(USER, GROUP, 'budget-1', '12000')).resolves.toMatchObject({ amount: '12000', currencyId: UAH });
  });

  it("keeps an account's amount in the account's currency", async () => {
    const { service } = makeService({ rows: [line({ categoryId: null, accountId: piggyBank.id, currencyId: USD })] });
    await expect(service.update(USER, GROUP, 'budget-1', '300')).resolves.toMatchObject({ amount: '300', currencyId: USD });
  });
});
