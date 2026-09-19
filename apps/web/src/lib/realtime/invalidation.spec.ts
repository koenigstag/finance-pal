import { describe, expect, it } from 'vitest';
import {
  REALTIME_ACTIONS,
  REALTIME_RESOURCE_TYPES,
  type RealtimeAction,
  type RealtimeResourceType,
} from '@ft/shared-contracts';
import { queryKeys } from '@/lib/query-keys';
import { invalidationFor, mergeInvalidations, reaches, type Invalidation } from './invalidation';

const groupId = '11111111-1111-4111-8111-111111111111';
const otherGroupId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const otherItemId = '44444444-4444-4444-8444-444444444444';

// A query of every kind the app caches: in the event's group, in another group, and outside groups.
const cached = {
  profile: queryKeys.profile,
  onboardingStatus: queryKeys.onboardingStatus,
  currencies: queryKeys.currencies,
  groups: queryKeys.groups,
  members: queryKeys.members(groupId),
  accounts: queryKeys.accounts(groupId),
  allAccounts: queryKeys.allAccounts(groupId),
  accountUsage: queryKeys.accountUsage(groupId, itemId),
  otherAccountUsage: queryKeys.accountUsage(groupId, otherItemId),
  categories: queryKeys.categories(groupId),
  categoryUsage: queryKeys.categoryUsage(groupId, itemId),
  otherCategoryUsage: queryKeys.categoryUsage(groupId, otherItemId),
  transactions: [...queryKeys.transactions(groupId), 'list', { type: 'expense' }],
  recurringRules: queryKeys.recurringRules(groupId),
  apiKeys: queryKeys.apiKeys(groupId),
  otherGroupAccounts: queryKeys.accounts(otherGroupId),
  otherGroupTransactions: [...queryKeys.transactions(otherGroupId), 'list', {}],
};
type Cached = keyof typeof cached;

const event = (resourceType: RealtimeResourceType, action: RealtimeAction) =>
  invalidationFor({ resourceType, action, resourceId: itemId, groupId });

/** The cached queries an invalidation reaches. */
const refetched = (invalidation: Invalidation) =>
  (Object.keys(cached) as Cached[]).filter((name) => reaches(invalidation, cached[name]));

const balances: Cached[] = ['accounts', 'allAccounts', 'accountUsage', 'otherAccountUsage'];
const categoryList: Cached[] = ['categories', 'categoryUsage', 'otherCategoryUsage'];

describe('invalidationFor', () => {
  it.each(['created', 'updated', 'deleted'] as const)(
    'refetches the list, the balances and the series for a transaction %s',
    (action) => {
      expect(refetched(event('Transaction', action))).toEqual([...balances, 'transactions', 'recurringRules']);
    },
  );

  it.each(['created', 'updated', 'deleted'] as const)(
    'refetches the rules and what their occurrences touch for a recurring rule %s',
    (action) => {
      expect(refetched(event('RecurringRule', action))).toEqual([...balances, 'transactions', 'recurringRules']);
    },
  );

  it.each(['created', 'updated', 'archived', 'restored'] as const)('refetches the accounts for an account %s', (action) => {
    expect(refetched(event('Account', action))).toEqual(balances);
  });

  it("refetches all of the group for a deleted account, except that account's usage", () => {
    expect(refetched(event('Account', 'deleted'))).toEqual([
      'members',
      'accounts',
      'allAccounts',
      'otherAccountUsage',
      ...categoryList,
      'transactions',
      'recurringRules',
      'apiKeys',
    ]);
  });

  it('refetches the accounts for a target', () => {
    expect(refetched(event('AccountTarget', 'updated'))).toEqual(balances);
  });

  it.each(['created', 'archived', 'restored', 'reordered'] as const)('refetches the categories for a category %s', (action) => {
    expect(refetched(event('Category', action))).toEqual(categoryList);
  });

  it('refetches the transactions as well for an updated category, which may have moved', () => {
    expect(refetched(event('Category', 'updated'))).toEqual([...categoryList, 'transactions']);
  });

  it("refetches all of the group for a deleted category, except that category's usage", () => {
    expect(refetched(event('Category', 'deleted'))).toEqual([
      'members',
      ...balances,
      'categories',
      'otherCategoryUsage',
      'transactions',
      'recurringRules',
      'apiKeys',
    ]);
  });

  it('refetches the transactions only for a deleted tag, whose id they carried', () => {
    expect(refetched(event('Tag', 'created'))).toEqual([]);
    expect(refetched(event('Tag', 'updated'))).toEqual([]);
    expect(refetched(event('Tag', 'deleted'))).toEqual(['transactions']);
  });

  it.each(['updated', 'archived', 'restored', 'deleted'] as const)('refetches the groups list for a group %s', (action) => {
    expect(refetched(event('Group', action))).toEqual(['groups']);
  });

  it("keeps a deleted group's queries out of whatever else the same burst refetches", () => {
    const burst = mergeInvalidations([event('Transaction', 'created'), event('Group', 'deleted')]);
    expect(refetched(burst)).toEqual(['groups']);
  });

  it.each(['created', 'updated', 'deleted'] as const)('refetches the members and the groups list for a member %s', (action) => {
    expect(refetched(event('GroupMember', action))).toEqual(['groups', 'members']);
  });

  it('never reaches another group, or what no event is about', () => {
    const untouched: Cached[] = ['profile', 'onboardingStatus', 'currencies', 'otherGroupAccounts', 'otherGroupTransactions'];
    for (const resourceType of REALTIME_RESOURCE_TYPES) {
      for (const action of REALTIME_ACTIONS) {
        expect(refetched(event(resourceType, action)).filter((name) => untouched.includes(name))).toEqual([]);
      }
    }
  });
});
