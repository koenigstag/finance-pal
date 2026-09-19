import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest } from '@ts-rest/core';
import type { onboardingContract } from '@ft/shared-contracts';
import { ApiError, api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export function useOnboardingStatus() {
  return useQuery({
    queryKey: queryKeys.onboardingStatus,
    queryFn: () => unwrap(api.onboarding.status(), 200),
  });
}

/** The caller's profile, or null before onboarding has created one. */
export function useProfile() {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () =>
      unwrap(api.onboarding.getProfile(), 200).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          return null;
        }
        throw error;
      }),
  });
}

type ProfileUpdate = ClientInferRequest<typeof onboardingContract.updateProfile>['body'];

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ProfileUpdate) => unwrap(api.onboarding.updateProfile({ body }), 200),
    onSuccess: async (profile) => {
      const previous = queryClient.getQueryData<{ mainCurrencyId: number } | null>(queryKeys.profile);
      queryClient.setQueryData(queryKeys.profile, profile);
      // Fetched rates are quoted against the main currency, so a new one needs a new set.
      if (previous && previous.mainCurrencyId !== profile.mainCurrencyId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.exchangeRates });
      }
      // Awaited so a caller navigating on success lands on fresh status, not the cached
      // "not onboarded" that would bounce it straight back.
      await queryClient.invalidateQueries({ queryKey: queryKeys.onboardingStatus });
    },
  });
}
