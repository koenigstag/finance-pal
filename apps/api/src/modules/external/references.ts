import { BadRequestException, NotFoundException } from '@nestjs/common';

// Reading the account and category a request refers to. Other apps may name them instead of
// quoting ids — a phone automation is written by hand — so a request carries either an id or a
// name for each. Everything here is pure: the caller loads the group's accounts and categories.

export interface AccountLike {
  id: string;
  name: string;
  archived: boolean;
  isFavourite: boolean;
  currencyId: number;
}

export interface CategoryLike {
  id: string;
  name: string;
  archived: boolean;
  type: string;
  parentId: string | null;
}

type TransactionKind = 'expense' | 'income' | 'transfer';

// Names compare the way a person reads them: regardless of case, surrounding spaces and how an
// accented letter happens to be encoded.
export function normalizeName(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

/**
 * Everything called `name` — only the active ones when there are any. An archived account keeps
 * its name after a new one takes it over, and the new one is what a request means.
 */
export function named<T extends { name: string; archived: boolean }>(items: readonly T[], name: string): T[] {
  const wanted = normalizeName(name);
  const matches = items.filter((item) => normalizeName(item.name) === wanted);
  const active = matches.filter((item) => !item.archived);
  return active.length > 0 ? active : matches;
}

/** The account a request names by id or by name in `field`, or undefined when it names none. */
export function findAccount<T extends AccountLike>(
  accounts: readonly T[],
  id: string | undefined,
  name: string | undefined,
  field: 'account' | 'toAccount',
): T | undefined {
  if (id !== undefined && name !== undefined) {
    throw new BadRequestException(`Send ${field}Id or ${field}Name, not both`);
  }
  if (id !== undefined) {
    const account = accounts.find((candidate) => candidate.id === id);
    if (!account) {
      throw new NotFoundException(field === 'account' ? 'Account not found' : 'Destination account not found');
    }
    return account;
  }
  if (name === undefined) {
    return undefined;
  }
  const matches = named(accounts, name);
  if (matches.length === 0) {
    throw new NotFoundException(`No account is named "${name}"`);
  }
  if (matches.length > 1) {
    throw new BadRequestException(`More than one account is named "${name}"; send ${field}Id instead`);
  }
  return matches[0];
}

// Where the app itself starts a new transaction.
export function favouriteAccount<T extends AccountLike>(accounts: readonly T[]): T {
  const favourite = accounts.find((account) => account.isFavourite && !account.archived);
  if (!favourite) {
    throw new BadRequestException('Send accountId or accountName: the group has no favourite account to use instead');
  }
  return favourite;
}

/**
 * What a transfer records as arrived. It's needed exactly when the two accounts' currencies
 * differ: the receiving account is credited destAmount, or the amount itself when there's none,
 * which is only right in the same currency. `current` is an update's stored value, reused only
 * while the currencies it was entered for still apply.
 */
export function transferDestAmount(
  from: AccountLike,
  to: AccountLike,
  requested: string | undefined,
  current: string | null = null,
): string | null {
  if (from.currencyId === to.currencyId) {
    if (requested !== undefined) {
      throw new BadRequestException('destAmount only applies to a transfer between accounts in different currencies');
    }
    return null;
  }
  const destAmount = requested ?? current;
  if (destAmount === null) {
    throw new BadRequestException(
      'A transfer between accounts in different currencies needs destAmount: the amount that arrived',
    );
  }
  return destAmount;
}

/**
 * The parent a category request names: an id is passed on as is — CategoriesService checks it is
 * a top-level category of the same type — and a name is looked up among exactly those. undefined
 * leaves the parent as it is; null (an update's) makes the category top-level.
 */
export function findParentId(
  categories: readonly CategoryLike[],
  type: string,
  parentId: string | null | undefined,
  parentName: string | undefined,
): string | null | undefined {
  if (parentId !== undefined && parentName !== undefined) {
    throw new BadRequestException('Send parentId or parentName, not both');
  }
  if (parentName === undefined) {
    return parentId;
  }
  const matches = named(
    categories.filter((candidate) => candidate.type === type && candidate.parentId === null),
    parentName,
  );
  if (matches.length === 0) {
    throw new NotFoundException(`No top-level ${type} category is named "${parentName}"`);
  }
  if (matches.length > 1) {
    throw new BadRequestException(`More than one ${type} category is named "${parentName}"; send parentId instead`);
  }
  return matches[0].id;
}

export interface CategoryReference {
  // null clears, on an update.
  categoryId?: string | null;
  categoryName?: string;
  subcategoryId?: string | null;
  subcategoryName?: string;
}

// What to store; a field left undefined stays as it is.
export interface CategoryPair {
  categoryId?: string | null;
  subcategoryId?: string | null;
}

export function namesCategory(reference: CategoryReference): boolean {
  return (
    reference.categoryId !== undefined ||
    reference.categoryName !== undefined ||
    reference.subcategoryId !== undefined ||
    reference.subcategoryName !== undefined
  );
}

/**
 * Turns the category a request names into the pair a transaction stores: a top-level category of
 * the transaction's type and, optionally, one of its subcategories. A subcategory named as the
 * category is filed under its parent; a subcategory named alone brings its parent along, looked
 * for first under `current` — the category an update starts from — then anywhere.
 */
export function resolveCategoryPair(
  categories: readonly CategoryLike[],
  type: TransactionKind,
  reference: CategoryReference,
  current: string | null = null,
): CategoryPair {
  if (reference.categoryId !== undefined && reference.categoryName !== undefined) {
    throw new BadRequestException('Send categoryId or categoryName, not both');
  }
  if (reference.subcategoryId !== undefined && reference.subcategoryName !== undefined) {
    throw new BadRequestException('Send subcategoryId or subcategoryName, not both');
  }

  const namesSubcategory =
    (reference.subcategoryId !== undefined && reference.subcategoryId !== null) || reference.subcategoryName !== undefined;
  const namesCategoryItself =
    (reference.categoryId !== undefined && reference.categoryId !== null) || reference.categoryName !== undefined;

  if (type === 'transfer') {
    if (namesCategoryItself || namesSubcategory) {
      throw new BadRequestException('A transfer has no category');
    }
    return {};
  }
  if (reference.categoryId === null) {
    if (namesSubcategory) {
      throw new BadRequestException('A subcategory needs its category');
    }
    return { categoryId: null, subcategoryId: null };
  }

  const category = namesCategoryItself ? findCategory(categories, type, reference) : undefined;
  if (category?.parentId) {
    // A subcategory given as the category, as the app's own API also accepts.
    if (namesSubcategory) {
      throw new BadRequestException(`"${category.name}" is a subcategory; send its category as the category`);
    }
    return { categoryId: category.parentId, subcategoryId: category.id };
  }

  if (!namesSubcategory) {
    // Only the category, or only clearing the subcategory: an update keeps what isn't named.
    return {
      ...(category && { categoryId: category.id }),
      ...(reference.subcategoryId === null && { subcategoryId: null }),
    };
  }

  const subcategory = findSubcategory(categories, type, reference, category, current);
  return { categoryId: category?.id ?? subcategory.parentId, subcategoryId: subcategory.id };
}

function findCategory(categories: readonly CategoryLike[], type: TransactionKind, reference: CategoryReference): CategoryLike {
  let category: CategoryLike;
  if (reference.categoryId) {
    const found = categories.find((candidate) => candidate.id === reference.categoryId);
    if (!found) {
      throw new NotFoundException('Category not found');
    }
    category = found;
  } else {
    const name = reference.categoryName as string;
    const matches = named(
      categories.filter((candidate) => candidate.type === type),
      name,
    );
    // A top-level category and a subcategory elsewhere may share a name; the category is meant.
    const topLevel = matches.filter((candidate) => candidate.parentId === null);
    const picked = topLevel.length === 1 ? topLevel : matches;
    if (picked.length === 0) {
      throw new NotFoundException(`No ${type} category is named "${name}"`);
    }
    if (picked.length > 1) {
      throw new BadRequestException(`More than one ${type} category is named "${name}"; send categoryId instead`);
    }
    category = picked[0];
  }
  assertType(category, type);
  return category;
}

function findSubcategory(
  categories: readonly CategoryLike[],
  type: TransactionKind,
  reference: CategoryReference,
  category: CategoryLike | undefined,
  current: string | null,
): CategoryLike & { parentId: string } {
  let subcategory: CategoryLike;
  if (reference.subcategoryId) {
    const found = categories.find((candidate) => candidate.id === reference.subcategoryId);
    if (!found) {
      throw new NotFoundException('Subcategory not found');
    }
    if (found.parentId === null) {
      throw new BadRequestException(`"${found.name}" is a category, not a subcategory`);
    }
    subcategory = found;
  } else {
    const name = reference.subcategoryName as string;
    const subcategories = categories.filter((candidate) => candidate.type === type && candidate.parentId !== null);
    const under = (parentId: string) => named(subcategories.filter((candidate) => candidate.parentId === parentId), name);
    let matches: CategoryLike[];
    if (category) {
      matches = under(category.id);
      if (matches.length === 0) {
        throw new NotFoundException(`"${category.name}" has no subcategory named "${name}"`);
      }
    } else {
      const underCurrent = current ? under(current) : [];
      matches = underCurrent.length > 0 ? underCurrent : named(subcategories, name);
      if (matches.length === 0) {
        throw new NotFoundException(`No ${type} subcategory is named "${name}"`);
      }
    }
    if (matches.length > 1) {
      throw new BadRequestException(
        `More than one ${type} subcategory is named "${name}"; send its category too, or subcategoryId`,
      );
    }
    subcategory = matches[0];
  }

  assertType(subcategory, type);
  if (category && subcategory.parentId !== category.id) {
    throw new BadRequestException(`"${subcategory.name}" isn't a subcategory of "${category.name}"`);
  }
  return subcategory as CategoryLike & { parentId: string };
}

// The app's own API doesn't check this; a request from elsewhere is where a mix-up is likely.
function assertType(category: CategoryLike, type: TransactionKind): void {
  if (category.type !== type) {
    throw new BadRequestException(`"${category.name}" is an ${category.type} category, and this is an ${type}`);
  }
}
