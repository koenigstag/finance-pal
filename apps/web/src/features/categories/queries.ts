import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClientInferRequest, ClientInferResponseBody } from '@ts-rest/core';
import type { categoriesContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { invalidateGroupAfterDelete, queryKeys } from '@/lib/query-keys';

export type Category = ClientInferResponseBody<typeof categoriesContract.get, 200>;
export type CreateCategoryBody = ClientInferRequest<typeof categoriesContract.create>['body'];
export type UpdateCategoryBody = ClientInferRequest<typeof categoriesContract.update>['body'];

/**
 * The group's categories. Archived ones are left out unless asked for — they belong to what is
 * already recorded, not to a picker — and are cached apart, so a screen that wants them doesn't
 * push them at the rest.
 */
export function useCategories(groupId: string, includeArchived = false) {
  return useQuery({
    queryKey: includeArchived ? queryKeys.allCategories(groupId) : queryKeys.categories(groupId),
    queryFn: () =>
      unwrap(api.categories.list({ params: { groupId }, query: { includeArchived: includeArchived ? 'true' : undefined } }), 200),
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
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.categories(groupId) });
      // Moving a category re-files its transactions on the server, since a transaction carries
      // the top-level category beside the subcategory. Refetching after any edit is simpler than
      // telling a move from a rename, and costs a page.
      if (input.categoryId !== undefined) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.transactions(groupId) });
      }
    },
  });
}

/**
 * Puts the categories in the order given — the whole tree of one type, parents and their
 * subcategories, as the list shows it. One request settles however many rows were dragged.
 */
export function useReorderCategories(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categoryIds: string[]) => unwrap(api.categories.reorder({ params: { groupId }, body: { categoryIds } }), 200),
    // Only where the categories sit changed, so nothing filed under them is stale.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories(groupId) }),
  });
}

/**
 * Puts a category away, or brings it back. Archiving keeps everything filed under the category and
 * only takes it out of the lists and the pickers, so the two directions are one mutation with a
 * flag rather than two hooks. The API carries the subcategories along either way.
 *
 * Invalidating the categories prefix covers both cached lists — the live one the pickers read and
 * the one the categories page reads, which includes archived ones — since either changes shape here.
 */
export function useSetCategoryArchived(groupId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ categoryId, archived }: { categoryId: string; archived: boolean }) =>
      archived
        ? unwrap(api.categories.archive({ params: { groupId, categoryId }, body: {} }), 200)
        : unwrap(api.categories.restore({ params: { groupId, categoryId }, body: {} }), 200),
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

/** One level of the tree: the categories of a type directly under parentId (null: the top level). */
export function categoriesUnder(categories: Category[], type: Category['type'], parentId: string | null): Category[] {
  return categories
    .filter((category) => category.type === type && category.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** The sortOrder that puts a new (or moved) category after its future siblings. */
export function nextSortOrder(categories: Category[], type: Category['type'], parentId: string | null): number {
  const siblings = categories.filter((category) => category.type === type && category.parentId === parentId);
  return siblings.reduce((max, category) => Math.max(max, category.sortOrder), 0) + 1;
}
