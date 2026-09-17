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
