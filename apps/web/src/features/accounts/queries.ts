import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { accountsContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { invalidateGroupAfterDelete, queryKeys } from '@/lib/query-keys';

export type Account = ClientInferResponseBody<typeof accountsContract.get, 200>;
export type CreateAccountBody = ClientInferRequest<typeof accountsContract.create>['body'];
export type UpdateAccountBody = ClientInferRequest<typeof accountsContract.update>['body'];

/**
 * The group's accounts. Archived ones are left out unless asked for — they belong in the past, not
 * in a picker — and are cached apart, so a screen that wants them doesn't push them at the rest.
 */
export function useAccounts(groupId: string, includeArchived = false) {
  return useQuery({
    queryKey: includeArchived ? queryKeys.allAccounts(groupId) : queryKeys.accounts(groupId),
    queryFn: () => unwrap(api.accounts.list({ params: { groupId }, query: { includeArchived: includeArchived ? 'true' : undefined } }), 200),
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
    // with the transfers: everything cached for the group is suspect.
    onSuccess: (_, accountId) =>
      invalidateGroupAfterDelete(queryClient, groupId, queryKeys.accountUsage(groupId, accountId)),
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
