import type { QueryClient, QueryKey } from '@tanstack/react-query';

// One place for every cache key, so invalidation after a mutation (or a realtime event) can't
// miss a query that was keyed slightly differently somewhere else.
//
// Group data lives under ['group', groupId, ...]: dropping a whole group's cache (or one
// resource in it) is a prefix match, and it can't collide with the groups list under ['groups'].
export const queryKeys = {
  profile: ['profile'] as const,
  onboardingStatus: ['onboarding', 'status'] as const,
  currencies: ['currencies'] as const,
  groups: ['groups'] as const,
  group: (groupId: string) => ['group', groupId] as const,
  members: (groupId: string) => ['group', groupId, 'members'] as const,
  accounts: (groupId: string) => ['group', groupId, 'accounts'] as const,
  allAccounts: (groupId: string) => ['group', groupId, 'accounts', 'all'] as const,
  accountUsage: (groupId: string, accountId: string) => ['group', groupId, 'accounts', accountId, 'usage'] as const,
  categories: (groupId: string) => ['group', groupId, 'categories'] as const,
  categoryUsage: (groupId: string, categoryId: string) =>
    ['group', groupId, 'categories', categoryId, 'usage'] as const,
  transactions: (groupId: string) => ['group', groupId, 'transactions'] as const,
  apiKeys: (groupId: string) => ['group', groupId, 'api-keys'] as const,
};

function startsWith(key: QueryKey, prefix: QueryKey): boolean {
  return prefix.every((part, index) => key[index] === part);
}

/**
 * Refetches everything cached for a group after a delete that cascades through it, except the
 * deleted item's own usage query: the confirmation dialog still shows it while closing, and
 * refetching a deleted item would only 404 and flash an error there.
 */
export function invalidateGroupAfterDelete(queryClient: QueryClient, groupId: string, deletedUsageKey: QueryKey) {
  return queryClient.invalidateQueries({
    queryKey: queryKeys.group(groupId),
    predicate: (query) => !startsWith(query.queryKey, deletedUsageKey),
  });
}
