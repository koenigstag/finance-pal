import type { Category } from './queries';

export interface CategoryTree {
  category: Category;
  children: Category[];
}

const byOrder = (a: Category, b: Category) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Two levels, as the API enforces. A subcategory whose parent isn't in the list (archived, or a
 * leftover of another type) is shown at the top level rather than hidden.
 */
export function buildTree(categories: Category[], type: Category['type']): CategoryTree[] {
  const ofType = categories.filter((category) => category.type === type);
  const topLevelIds = new Set(ofType.filter((category) => category.parentId === null).map((category) => category.id));
  return ofType
    .filter((category) => category.parentId === null || !topLevelIds.has(category.parentId))
    .sort(byOrder)
    .map((category) => ({
      category,
      children: ofType.filter((child) => child.parentId === category.id).sort(byOrder),
    }));
}

/** The list with the item at `from` taken out and put back in at `to`. */
export function move<T>(items: readonly T[], from: number, to: number): T[] {
  const moved = [...items];
  const [item] = moved.splice(from, 1);
  moved.splice(to, 0, item);
  return moved;
}

/** The tree with one of a parent's subcategories moved among its siblings. */
export function moveSubcategory(tree: readonly CategoryTree[], parentId: string, from: number, to: number): CategoryTree[] {
  return tree.map((node) =>
    node.category.id === parentId ? { ...node, children: move(node.children, from, to) } : node,
  );
}

/**
 * Every category in the tree, each parent followed by its own subcategories — the order a reorder
 * is sent in, and the one the list is read in.
 */
export function orderedIds(tree: readonly CategoryTree[]): string[] {
  return tree.flatMap(({ category, children }) => [category.id, ...children.map((child) => child.id)]);
}
