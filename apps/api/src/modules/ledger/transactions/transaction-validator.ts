import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, Category, TransactionType } from '@ft/api-database';
import { isPercentageInRange, isPositiveMoney } from '@ft/shared-contracts';

// The money-movement part of a transaction — shared by transactions and recurring rules, which
// carry the same fields (a rule has no destAmount or percentage, so it passes null for those).
export interface TransactionShape {
  type: TransactionType;
  accountId: string;
  categoryId: string | null;
  subcategoryId: string | null;
  toAccountId: string | null;
  amount: string;
  destAmount: string | null;
  percentage: string | null;
  percentageBase: string | null;
}

// What a transaction is filed under, as it's stored: a top-level category and, optionally, one of
// its own subcategories.
export type CategoryPair = Pick<TransactionShape, 'categoryId' | 'subcategoryId'>;

/**
 * The subcategory an update leaves in place when it doesn't name one: a subcategory belongs to its
 * category, so it stays while the category does and goes when the category changes.
 */
export function keptSubcategory(
  patch: { subcategoryId?: string | null },
  existing: CategoryPair,
  categoryId: string | null,
): string | null {
  if (patch.subcategoryId !== undefined) {
    return patch.subcategoryId;
  }
  return categoryId === existing.categoryId ? existing.subcategoryId : null;
}

/**
 * The base amount an update leaves in place when it doesn't name one: it's what the percentage is
 * of, so it stays while there's a percentage and goes when the percentage does.
 */
export function keptPercentageBase(
  patch: { percentageBase?: string | null },
  existing: { percentageBase: string | null },
  percentage: string | null,
): string | null {
  if (patch.percentageBase !== undefined) {
    return patch.percentageBase;
  }
  return percentage === null ? null : existing.percentageBase;
}

/**
 * When a transaction's percentage of the balance (no base amount) was taken: now, whenever what it
 * comes from — the percentage or the account — is new or changed, since the client has just worked
 * it out afresh; otherwise the moment it already had. Taken before the transaction's `date`, the
 * amount is an estimate, worked out again once that date comes — which only a date still ahead
 * can be: saved with a date already past, the amount stands as the user saw it. A planned
 * transaction moved to another future day, or with only its note changed, so stays an estimate.
 * Null when the amount isn't a percentage of the balance.
 */
export function keptPercentageAsOf(
  existing: { percentage: string | null; accountId: string; percentageAsOf: Date | null } | null,
  merged: { percentage: string | null; percentageBase: string | null; accountId: string },
  date: Date,
  now: Date,
): Date | null {
  if (merged.percentage === null || merged.percentageBase !== null) {
    return null;
  }
  let asOf = now;
  if (
    existing !== null &&
    existing.percentageAsOf !== null &&
    existing.percentage !== null &&
    // numeric(7,4) reads back padded ("3.5000"): the same percentage may not be the same text.
    Number(existing.percentage) === Number(merged.percentage) &&
    existing.accountId === merged.accountId
  ) {
    asOf = existing.percentageAsOf;
  }
  return asOf.getTime() < date.getTime() && date.getTime() <= now.getTime() ? now : asOf;
}

/**
 * Checks, in application code, what the database would otherwise reject with a raw error: the
 * check constraints (chk_transaction_sides / chk_transaction_amount_positive /
 * chk_transaction_subcategory and their recurring twins, chk_transaction_percentage /
 * chk_transaction_percentage_base) and the check_group_consistency trigger.
 * GlobalExceptionFilter turns any non-HTTP error into a bare 500, so without this a bad request
 * would look like a server fault.
 */
@Injectable()
export class TransactionValidator {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
  ) {}

  /** Throws for a shape that can't be stored; otherwise returns its category pair to store. */
  async validate(groupId: string, shape: TransactionShape): Promise<CategoryPair> {
    if (!isPositiveMoney(shape.amount)) {
      throw new BadRequestException('amount must be greater than zero');
    }
    if (shape.destAmount !== null && !isPositiveMoney(shape.destAmount)) {
      throw new BadRequestException('destAmount must be greater than zero');
    }
    if (shape.percentage !== null && !isPercentageInRange(shape.percentage)) {
      throw new BadRequestException('percentage must be greater than zero and at most 100');
    }
    if (shape.percentageBase !== null) {
      if (shape.percentage === null) {
        throw new BadRequestException('percentageBase needs a percentage');
      }
      if (!isPositiveMoney(shape.percentageBase)) {
        throw new BadRequestException('percentageBase must be greater than zero');
      }
    }

    if (shape.type === TransactionType.TRANSFER) {
      if (!shape.toAccountId) {
        throw new BadRequestException('A transfer requires toAccountId');
      }
      if (shape.categoryId || shape.subcategoryId) {
        throw new BadRequestException('A transfer cannot have a category');
      }
    } else if (shape.toAccountId) {
      throw new BadRequestException('Only a transfer can have toAccountId');
    }

    const account = await this.accounts.findOneBy({ id: shape.accountId, groupId });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    if (shape.toAccountId) {
      const toAccount = await this.accounts.findOneBy({ id: shape.toAccountId, groupId });
      if (!toAccount) {
        throw new NotFoundException('Destination account not found');
      }
    }
    return this.categoryPair(groupId, shape.categoryId, shape.subcategoryId);
  }

  /**
   * A subcategory given as the category — the only way to pick one before subcategories had a
   * field of their own, and still what an out-of-date client sends — is read as that subcategory
   * under its parent, rather than refused.
   */
  private async categoryPair(groupId: string, categoryId: string | null, subcategoryId: string | null): Promise<CategoryPair> {
    if (!categoryId) {
      if (subcategoryId) {
        throw new BadRequestException('A subcategory needs its category');
      }
      return { categoryId: null, subcategoryId: null };
    }

    const category = await this.categories.findOneBy({ id: categoryId, groupId });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    if (category.parentId !== null) {
      if (subcategoryId && subcategoryId !== category.id) {
        throw new BadRequestException('categoryId must be a top-level category');
      }
      return { categoryId: category.parentId, subcategoryId: category.id };
    }
    if (!subcategoryId) {
      return { categoryId, subcategoryId: null };
    }

    const subcategory = await this.categories.findOneBy({ id: subcategoryId, groupId });
    if (!subcategory) {
      throw new NotFoundException('Subcategory not found');
    }
    if (subcategory.parentId !== category.id) {
      throw new BadRequestException('The subcategory belongs to another category');
    }
    return { categoryId, subcategoryId };
  }
}
