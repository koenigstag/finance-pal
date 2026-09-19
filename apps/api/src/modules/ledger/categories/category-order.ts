// Enough of a category to place it: the level it belongs to, and where it sits there now.
export interface OrderedCategory {
  id: string;
  type: string;
  parentId: string | null;
  sortOrder: number;
}

export interface SortOrderChange {
  id: string;
  sortOrder: number;
}

/**
 * Where each category lands when the list is given back in the order it should appear: its place
 * among the siblings it shares a level with — same type, same parent — counted from 0.
 *
 * Levels are counted apart, so one list can carry a whole tree: the top-level categories and the
 * subcategories under each of them, income's and expense's alike, each level numbered from its
 * own 0. Only the categories that actually move come back, so nudging one row writes one row.
 */
export function sortOrderChanges(ordered: readonly OrderedCategory[]): SortOrderChange[] {
  const nextPlace = new Map<string, number>();
  const changes: SortOrderChange[] = [];
  for (const category of ordered) {
    const level = `${category.type}:${category.parentId ?? ''}`;
    const sortOrder = nextPlace.get(level) ?? 0;
    nextPlace.set(level, sortOrder + 1);
    if (category.sortOrder !== sortOrder) {
      changes.push({ id: category.id, sortOrder });
    }
  }
  return changes;
}
