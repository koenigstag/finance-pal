import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { recurringRulesContract, transactionsContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export type Transaction = ClientInferResponseBody<typeof transactionsContract.get, 200>;
export type TransactionBody = ClientInferRequest<typeof transactionsContract.create>['body'];
export type TransactionPatch = ClientInferRequest<typeof transactionsContract.update>['body'];
export type TransactionFilters = Omit<ClientInferRequest<typeof transactionsContract.list>['query'], 'cursor'>;

export type RecurringRule = ClientInferResponseBody<typeof recurringRulesContract.get, 200>;
export type RecurringRuleBody = ClientInferRequest<typeof recurringRulesContract.create>['body'];
export type RecurringRulePatch = ClientInferRequest<typeof recurringRulesContract.update>['body'];

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

/** The group's running series; paused ones have nothing planned, so nothing shows them. */
export function useRecurringRules(groupId: string) {
  return useQuery({
    queryKey: queryKeys.recurringRules(groupId),
    queryFn: () => unwrap(api.recurringRules.list({ params: { groupId }, query: {} }), 200),
  });
}

// A transaction moves money, so every write also changes account balances; and a series writes
// transactions, while skipping or moving one of its occurrences changes when it next produces one.
function invalidateAfterTransactionWrite(queryClient: QueryClient, groupId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.transactions(groupId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.accounts(groupId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.recurringRules(groupId) }),
  ]);
}

/** Records a transaction (no transactionId) or changes one, as much of it as the body names. */
export function useSaveTransaction(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: { transactionId?: undefined; body: TransactionBody } | { transactionId: string; body: TransactionPatch }) =>
      request.transactionId === undefined
        ? unwrap(api.transactions.create({ params: { groupId }, body: request.body }), 201)
        : unwrap(api.transactions.update({ params: { groupId, transactionId: request.transactionId }, body: request.body }), 200),
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

/** Starts a series (no ruleId) or changes one. */
export function useSaveRecurringRule(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: { ruleId?: undefined; body: RecurringRuleBody } | { ruleId: string; body: RecurringRulePatch }) =>
      request.ruleId === undefined
        ? unwrap(api.recurringRules.create({ params: { groupId }, body: request.body }), 201)
        : unwrap(api.recurringRules.update({ params: { groupId, ruleId: request.ruleId }, body: request.body }), 200),
    onSuccess: () => invalidateAfterTransactionWrite(queryClient, groupId),
  });
}

/**
 * Stops a series. What it already recorded stays; its planned occurrence goes with it, or with
 * keepPlanned stays as a one-off — the series then ends with that transaction.
 */
export function useDeleteRecurringRule(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ruleId, keepPlanned }: { ruleId: string; keepPlanned?: boolean }) =>
      unwrap(
        api.recurringRules.remove({ params: { groupId, ruleId }, query: { keepPlanned: keepPlanned ? 'true' : undefined } }),
        200,
      ),
    onSuccess: () => invalidateAfterTransactionWrite(queryClient, groupId),
  });
}
