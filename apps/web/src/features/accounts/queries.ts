import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { accountsContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { invalidateGroupAfterDelete, queryKeys } from '@/lib/query-keys';

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
    // with the transfers: everything cached for the group is suspect.
    onSuccess: (_, accountId) =>
      invalidateGroupAfterDelete(queryClient, groupId, queryKeys.accountUsage(groupId, accountId)),
  });
}

/**
 * Stars or unstars an account right away in the list, reverting if the API refuses. Starring
 * unstars the others, as the API does.
 */
export function useSetFavouriteAccount(groupId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.accounts(groupId);

  return useMutation({
    mutationFn: ({ accountId, isFavourite }: { accountId: string; isFavourite: boolean }) =>
      unwrap(api.accounts.update({ params: { groupId, accountId }, body: { isFavourite } }), 200),
    onMutate: async ({ accountId, isFavourite }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Account[]>(key);
      queryClient.setQueryData<Account[]>(key, (accounts) =>
        accounts?.map((account) =>
          account.id === accountId ? { ...account, isFavourite } : isFavourite ? { ...account, isFavourite: false } : account,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) => {
      queryClient.setQueryData(key, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
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
