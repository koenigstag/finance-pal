import { useQuery } from '@tanstack/react-query';
import type { ClientInferResponseBody } from '@ts-rest/core';
import type { categoriesContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';

export type Category = ClientInferResponseBody<typeof categoriesContract.get, 200>;

export function useCategories(groupId: string) {
  return useQuery({
    queryKey: queryKeys.categories(groupId),
    queryFn: () => unwrap(api.categories.list({ params: { groupId }, query: {} }), 200),
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
