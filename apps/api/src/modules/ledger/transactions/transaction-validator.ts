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
  toAccountId: string | null;
  amount: string;
  destAmount: string | null;
}

/**
 * Checks, in application code, what the database would otherwise reject with a raw error: the
 * check constraints (chk_transaction_sides / chk_transaction_amount_positive and their recurring
 * twins) and the check_group_consistency trigger. GlobalExceptionFilter turns any non-HTTP error
 * into a bare 500, so without this a bad request would look like a server fault.
 */
@Injectable()
export class TransactionValidator {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
  ) {}

  async assertValid(groupId: string, shape: TransactionShape): Promise<void> {
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
      if (shape.categoryId) {
        throw new BadRequestException('A transfer cannot have a categoryId');
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
    if (shape.categoryId) {
      const category = await this.categories.findOneBy({ id: shape.categoryId, groupId });
      if (!category) {
        throw new NotFoundException('Category not found');
      }
    }
  }
}
