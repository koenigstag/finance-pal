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
  accounts: (groupId: string) => ['group', groupId, 'accounts'] as const,
  accountUsage: (groupId: string, accountId: string) => ['group', groupId, 'accounts', accountId, 'usage'] as const,
  categories: (groupId: string) => ['group', groupId, 'categories'] as const,
  transactions: (groupId: string) => ['group', groupId, 'transactions'] as const,
};
