import type { Category } from '@/features/categories/queries';
import type { Transaction } from './queries';

export interface FiledUnder {
  // "Category › Subcategory", or the category's name alone.
  name: string;
  // The subcategory's own look where it has one, the category's otherwise.
  icon: string | null;
  color: string | null;
}

/**
 * How a transaction's category reads wherever the transaction is shown: with the subcategory
 * after it when there is one, so a row says where it sits without being opened. Undefined when it
 * has no category, or when neither is among the categories given.
 */
export function filedUnder(
  transaction: Pick<Transaction, 'categoryId' | 'subcategoryId'>,
  find: (id: string) => Category | undefined,
): FiledUnder | undefined {
  const category = transaction.categoryId ? find(transaction.categoryId) : undefined;
  const subcategory = transaction.subcategoryId ? find(transaction.subcategoryId) : undefined;
  if (!category && !subcategory) {
    return undefined;
  }
  return {
    name: [category?.name, subcategory?.name].filter(Boolean).join(' › '),
    icon: subcategory?.icon ?? category?.icon ?? null,
    color: subcategory?.color ?? category?.color ?? null,
  };
}
