import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { categoryRulesContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export type CategoryRule = ClientInferResponseBody<typeof categoryRulesContract.list, 200>[number];
export type CategoryRuleBody = ClientInferRequest<typeof categoryRulesContract.create>['body'];

/** The group's category rules, alphabetically by their text. */
export function useCategoryRules(groupId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.categoryRules(groupId),
    queryFn: () => unwrap(api.categoryRules.list({ params: { groupId } }), 200),
    enabled,
  });
}

/** Adds a rule, or changes the one ruleId names. */
export function useSaveCategoryRule(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ruleId, body }: { ruleId?: string; body: CategoryRuleBody }) =>
      ruleId
        ? unwrap(api.categoryRules.update({ params: { groupId, ruleId }, body }), 200)
        : unwrap(api.categoryRules.create({ params: { groupId }, body }), 201),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categoryRules(groupId) }),
  });
}

export function useDeleteCategoryRule(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ruleId: string) => unwrap(api.categoryRules.remove({ params: { groupId, ruleId } }), 200),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categoryRules(groupId) }),
  });
}

/**
 * Whether another rule already has this text, compared as the API compares them: without regard
 * to case or the spaces around it. The API refuses such a rule; saying so here is kinder.
 */
export function patternTaken(rules: readonly CategoryRule[], pattern: string, exceptRuleId?: string): boolean {
  const wanted = pattern.trim().toLowerCase();
  return rules.some((rule) => rule.id !== exceptRuleId && rule.pattern.trim().toLowerCase() === wanted);
}
