// One place for every cache key, so invalidation after a mutation (or a realtime event) can't
// miss a query that was keyed slightly differently somewhere else.
export const queryKeys = {
  profile: ['profile'] as const,
  onboardingStatus: ['onboarding', 'status'] as const,
  currencies: ['currencies'] as const,
  groups: ['groups'] as const,
};
