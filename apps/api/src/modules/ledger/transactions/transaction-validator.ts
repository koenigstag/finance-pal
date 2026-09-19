import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, Category, TransactionType } from '@ft/api-database';
import { isPercentageInRange, isPositiveMoney, isRoundBalanceStep } from '@ft/shared-contracts';
import { isFromBalance } from '../../recurring/derived-amount';

// The money-movement part of a transaction — shared by transactions and recurring rules, which
// carry the same fields (a rule has no destAmount, so it passes null for that).
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
  roundBalanceTo: number | null;
}

// What an update may name of where the amount comes from.
interface AmountSourcePatch {
  percentage?: string | null;
  roundBalanceTo?: number | null;
}

/**
 * The percentage an update leaves in place when it doesn't name one: it goes when the update rounds
 * the balance instead, the two being different ways to work the amount out.
 */
export function keptPercentage(patch: AmountSourcePatch, existing: { percentage: string | null }): string | null {
  if (patch.percentage !== undefined) {
    return patch.percentage;
  }
  return patch.roundBalanceTo != null ? null : existing.percentage;
}

/** The step an update leaves in place when it doesn't name one: it goes for a new percentage. */
export function keptRoundBalanceTo(patch: AmountSourcePatch, existing: { roundBalanceTo: number | null }): number | null {
  if (patch.roundBalanceTo !== undefined) {
    return patch.roundBalanceTo;
  }
  return patch.percentage != null ? null : existing.roundBalanceTo;
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

type AmountSourceFields = { percentage: string | null; percentageBase: string | null; roundBalanceTo: number | null };

// The same way of working the amount out: the same step, or the same percentage — compared as
// numbers, since numeric(7,4) reads back padded ("3.5000") and a patch has it as typed ("3.5").
function sameSource(a: Omit<AmountSourceFields, 'percentageBase'>, b: Omit<AmountSourceFields, 'percentageBase'>): boolean {
  if (a.roundBalanceTo !== null || b.roundBalanceTo !== null) {
    return a.roundBalanceTo === b.roundBalanceTo;
  }
  return a.percentage !== null && b.percentage !== null && Number(a.percentage) === Number(b.percentage);
}

/**
 * When a transaction's amount was last worked out from its account's balance (a percentage of it
 * with no base amount, or a rounding of it). Earlier than its `date`, the amount is an estimate:
 * the API works it out again as the balance changes, and a last time once the date comes, when it
 * stays (see reworkEstimates).
 *
 * Now, whenever what it comes from (the percentage or the step, or the account) is new or changed:
 * the client has just worked it out afresh. Otherwise it keeps what it had. An estimate so stays
 * one, moved to another day ahead or to now alike ("Add now" lands it, and landing works it out a
 * last time), while a recorded amount moved to another day already past isn't made an estimate.
 * Null when the amount doesn't come from the balance.
 */
export function keptPercentageAsOf(
  existing:
    | ({ date: Date; accountId: string; percentageAsOf: Date | null } & Omit<AmountSourceFields, 'percentageBase'>)
    | null,
  merged: AmountSourceFields & { accountId: string },
  date: Date,
  now: Date,
): Date | null {
  if (!isFromBalance(merged)) {
    return null;
  }
  if (
    existing === null ||
    existing.percentageAsOf === null ||
    existing.accountId !== merged.accountId ||
    !sameSource(existing, merged)
  ) {
    return now;
  }
  const asOf = existing.percentageAsOf;
  const recorded = asOf.getTime() >= existing.date.getTime();
  if (recorded && asOf.getTime() < date.getTime() && date.getTime() <= now.getTime()) {
    return now;
  }
  return asOf;
}

/**
 * Checks, in application code, what the database would otherwise reject with a raw error: the
 * check constraints (chk_transaction_sides / chk_transaction_amount_positive /
 * chk_transaction_subcategory and their recurring twins, chk_transaction_percentage /
 * chk_transaction_percentage_base / chk_transaction_round_balance_to) and the
 * check_group_consistency trigger.
 * GlobalExceptionFilter turns any non-HTTP error into a bare 500, so without this a bad request
 * would look like a server fault.
 */
@Injectable()
export class TransactionValidator {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
  ) {}

  /**
   * Throws for a shape that can't be stored; otherwise returns its category pair to store.
   *
   * `estimate`: a planned transaction or a series, whose amount from the balance is only what it
   * comes to as things stand. That may be nothing for now — a balance on a round figure already, an
   * empty one — and it's worked out again until its date, so it may be zero.
   */
  async validate(groupId: string, shape: TransactionShape, { estimate = false }: { estimate?: boolean } = {}): Promise<CategoryPair> {
    const nothingForNow = estimate && isFromBalance(shape) && Number(shape.amount) === 0;
    if (!isPositiveMoney(shape.amount) && !nothingForNow) {
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
    if (shape.roundBalanceTo !== null) {
      if (!isRoundBalanceStep(shape.roundBalanceTo)) {
        throw new BadRequestException('roundBalanceTo must be 1, 10, 100 or 1000');
      }
      if (shape.percentage !== null) {
        throw new BadRequestException('An amount comes from a percentage or from rounding the balance, not both');
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
