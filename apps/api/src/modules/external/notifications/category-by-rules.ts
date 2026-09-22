import { folded } from './notification-text';

export interface RuleLike {
  pattern: string;
  categoryId: string;
  createdAt: Date;
}

export interface RuleCategoryLike {
  id: string;
  type: string;
  parentId: string | null;
  archived: boolean;
}

// What a transaction stores: a top-level category and, when the rule named one, its subcategory.
export interface FiledUnder {
  categoryId: string;
  subcategoryId: string | null;
}

/**
 * Where the group's category rules file a transaction whose shop is `name`: under the rule whose
 * text the name contains. When several do, the longest text wins — "Uber Eats" is surer of itself
 * than "Uber" — and the oldest rule between equals. A rule only files a transaction of its
 * category's type, into a category still in use: an archived one, or a subcategory of one, is
 * passed over. Null when no rule fits.
 */
export function categoryByRules(
  rules: readonly RuleLike[],
  categories: readonly RuleCategoryLike[],
  type: string,
  name: string,
): FiledUnder | null {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const inUse = (category: RuleCategoryLike | undefined): category is RuleCategoryLike =>
    category !== undefined && !category.archived && category.type === type;

  const wanted = matchable(name);
  let best: { rule: RuleLike; pattern: string; category: RuleCategoryLike } | null = null;
  for (const rule of rules) {
    const category = byId.get(rule.categoryId);
    if (!inUse(category) || (category.parentId !== null && !inUse(byId.get(category.parentId)))) {
      continue;
    }
    const pattern = matchable(rule.pattern);
    if (!pattern || !wanted.includes(pattern)) {
      continue;
    }
    const longer = !best || pattern.length > best.pattern.length;
    const olderOfEquals = best !== null && pattern.length === best.pattern.length && rule.createdAt < best.rule.createdAt;
    if (longer || olderOfEquals) {
      best = { rule, pattern, category };
    }
  }

  if (!best) {
    return null;
  }
  const { category } = best;
  return category.parentId === null
    ? { categoryId: category.id, subcategoryId: null }
    : { categoryId: category.parentId, subcategoryId: category.id };
}

// Names as a person reads them: regardless of case, of spacing, and of whether an i was typed in
// Latin or Cyrillic — banks mix the two ("Сiльпо"), and a rule is typed on a phone.
function matchable(text: string): string {
  return folded(text.normalize('NFC')).replace(/\s+/g, ' ').trim();
}
