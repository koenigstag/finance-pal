import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { accountsContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export type Account = ClientInferResponseBody<typeof accountsContract.get, 200>;
export type CreateAccountBody = ClientInferRequest<typeof accountsContract.create>['body'];
export type UpdateAccountBody = ClientInferRequest<typeof accountsContract.update>['body'];

export function useAccounts(groupId: string) {
  return useQuery({
    queryKey: queryKeys.accounts(groupId),
    queryFn: () => unwrap(api.accounts.list({ params: { groupId }, query: {} }), 200),
  });
}

export function useAccountUsage(groupId: string, accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.accountUsage(groupId, accountId),
    queryFn: () => unwrap(api.accounts.usage({ params: { groupId, accountId } }), 200),
    enabled,
    // Counted fresh for every confirmation: a stale count is exactly what it must not show.
    staleTime: 0,
    gcTime: 0,
  });
}

export function useDeleteAccount(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accountId: string) => unwrap(api.accounts.remove({ params: { groupId, accountId } }), 200),
    // Its transactions and recurring rules went with it, and other accounts' balances changed
    // with the transfers: everything cached for the group is suspect. Except the deleted account's
    // own usage, which the still-open confirmation shows: refetching it would only 404 and flash
    // an error before the dialog closes.
    onSuccess: (_, accountId) => {
      const usageKey = queryKeys.accountUsage(groupId, accountId);
      return queryClient.invalidateQueries({
        queryKey: queryKeys.group(groupId),
        predicate: (query) => usageKey.some((part, index) => query.queryKey[index] !== part),
      });
    },
  });
}

export function useSaveAccount(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ accountId, body }: { accountId?: string; body: CreateAccountBody }) =>
      accountId
        ? unwrap(api.accounts.update({ params: { groupId, accountId }, body }), 200)
        : unwrap(api.accounts.create({ params: { groupId }, body }), 201),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts(groupId) }),
  });
}
