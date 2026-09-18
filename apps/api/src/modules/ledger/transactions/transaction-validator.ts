import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, Category, TransactionType } from '@ft/api-database';
import { isPositiveMoney } from '@ft/shared-contracts';

// The money-movement part of a transaction — shared by transactions and recurring rules, which
// carry the same fields (a rule has no destAmount, so it passes null).
export interface TransactionShape {
  type: TransactionType;
  accountId: string;
  categoryId: string | null;
  subcategoryId: string | null;
  toAccountId: string | null;
  amount: string;
  destAmount: string | null;
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
 * Checks, in application code, what the database would otherwise reject with a raw error: the
 * check constraints (chk_transaction_sides / chk_transaction_amount_positive /
 * chk_transaction_subcategory and their recurring twins) and the check_group_consistency trigger.
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
