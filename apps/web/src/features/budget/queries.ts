import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { budgetsContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { monthRange, parseMonthParam } from '@/lib/dates';
import { queryKeys } from '@/lib/query-keys';

export type Budget = ClientInferResponseBody<typeof budgetsContract.list, 200>[number];
export type BudgetTotals = ClientInferResponseBody<typeof budgetsContract.totals, 200>;
export type CreateBudgetBody = ClientInferRequest<typeof budgetsContract.create>['body'];

/** A month's lines, by its YYYY-MM. Not fetched while `enabled` is false. */
export function useBudgets(groupId: string, month: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.budgetLines(groupId, month),
    queryFn: () => unwrap(api.budgets.list({ params: { groupId }, query: { month } }), 200),
    enabled,
  });
}

/**
 * What moved in the month, as this device's calendar has it — the same bounds the transactions list
 * uses. Not fetched while `enabled` is false.
 */
export function useBudgetTotals(groupId: string, month: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.budgetTotals(groupId, month),
    queryFn: () => unwrap(api.budgets.totals({ params: { groupId }, query: monthRange(parseMonthParam(month)) }), 200),
    enabled,
  });
}

/** Adds a line, or changes the amount of the one budgetId names. */
export function useSaveBudget(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { budgetId: string; amount: string } | { body: CreateBudgetBody }) =>
      'budgetId' in input
        ? unwrap(api.budgets.update({ params: { groupId, budgetId: input.budgetId }, body: { amount: input.amount } }), 200)
        : unwrap(api.budgets.create({ params: { groupId }, body: input.body }), 201),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgets(groupId) }),
  });
}

export function useDeleteBudget(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (budgetId: string) => unwrap(api.budgets.remove({ params: { groupId, budgetId } }), 200),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgets(groupId) }),
  });
}
