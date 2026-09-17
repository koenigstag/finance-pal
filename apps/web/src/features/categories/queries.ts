import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { categoriesContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { invalidateGroupAfterDelete, queryKeys } from '@/lib/query-keys';

export type Category = ClientInferResponseBody<typeof categoriesContract.get, 200>;
export type CreateCategoryBody = ClientInferRequest<typeof categoriesContract.create>['body'];
export type UpdateCategoryBody = ClientInferRequest<typeof categoriesContract.update>['body'];

export function useCategories(groupId: string) {
  return useQuery({
    queryKey: queryKeys.categories(groupId),
    queryFn: () => unwrap(api.categories.list({ params: { groupId }, query: {} }), 200),
  });
}

type SaveCategoryInput = { categoryId?: undefined; body: CreateCategoryBody } | { categoryId: string; body: UpdateCategoryBody };

export function useSaveCategory(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SaveCategoryInput) => {
      if (input.categoryId === undefined) {
        return unwrap(api.categories.create({ params: { groupId }, body: input.body }), 201);
      }
      return unwrap(api.categories.update({ params: { groupId, categoryId: input.categoryId }, body: input.body }), 200);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories(groupId) }),
  });
}

export function useCategoryUsage(groupId: string, categoryId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.categoryUsage(groupId, categoryId),
    queryFn: () => unwrap(api.categories.usage({ params: { groupId, categoryId } }), 200),
    enabled,
    // Counted fresh for every confirmation: a stale count is exactly what it must not show.
    staleTime: 0,
    gcTime: 0,
  });
}

export function useDeleteCategory(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categoryId: string) => unwrap(api.categories.remove({ params: { groupId, categoryId } }), 200),
    // Transactions and recurring rules lost their category, so their cached lists are stale too.
    onSuccess: (_, categoryId) =>
      invalidateGroupAfterDelete(queryClient, groupId, queryKeys.categoryUsage(groupId, categoryId)),
  });
}

export interface CategoryOption {
  category: Category;
  depth: number;
}

/**
 * Flattens the parentId tree into picker order: each parent followed by its children, siblings
 * by sortOrder then name. Only categories of the given type; an orphan (parent archived or of
 * another type) is shown at the top level rather than hidden.
 */
export function categoryOptions(categories: Category[], type: Category['type']): CategoryOption[] {
  const ofType = categories.filter((category) => category.type === type);
  const ids = new Set(ofType.map((category) => category.id));
  const byParent = new Map<string | null, Category[]>();
  for (const category of ofType) {
    const parentId = category.parentId && ids.has(category.parentId) ? category.parentId : null;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), category]);
  }

  const result: CategoryOption[] = [];
  const visit = (parentId: string | null, depth: number) => {
    const children = [...(byParent.get(parentId) ?? [])].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    for (const category of children) {
      result.push({ category, depth });
      visit(category.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

/** The sortOrder that puts a new (or moved) category after its future siblings. */
export function nextSortOrder(categories: Category[], type: Category['type'], parentId: string | null): number {
  const siblings = categories.filter((category) => category.type === type && category.parentId === parentId);
  return siblings.reduce((max, category) => Math.max(max, category.sortOrder), 0) + 1;
}
