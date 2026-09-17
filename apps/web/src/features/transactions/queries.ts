import { useInfiniteQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { transactionsContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export type Transaction = ClientInferResponseBody<typeof transactionsContract.get, 200>;
export type TransactionBody = ClientInferRequest<typeof transactionsContract.create>['body'];
export type TransactionFilters = Omit<ClientInferRequest<typeof transactionsContract.list>['query'], 'cursor'>;

export function useTransactionPages(groupId: string, filters: TransactionFilters) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.transactions(groupId), 'list', filters],
    queryFn: ({ pageParam }) =>
      unwrap(
        api.transactions.list({ params: { groupId }, query: { ...filters, cursor: pageParam ?? undefined } }),
        200,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
}

// A transaction moves money, so every write also changes account balances.
function invalidateAfterTransactionWrite(queryClient: QueryClient, groupId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.transactions(groupId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts(groupId) }),
  ]);
}

export function useSaveTransaction(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ transactionId, body }: { transactionId?: string; body: TransactionBody }) =>
      transactionId
        ? unwrap(api.transactions.update({ params: { groupId, transactionId }, body }), 200)
        : unwrap(api.transactions.create({ params: { groupId }, body }), 201),
    onSuccess: () => invalidateAfterTransactionWrite(queryClient, groupId),
  });
}

export function useDeleteTransaction(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transactionId: string) =>
      unwrap(api.transactions.remove({ params: { groupId, transactionId } }), 200),
    onSuccess: () => invalidateAfterTransactionWrite(queryClient, groupId),
  });
}
