import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Account, Budget, Category, Profile } from '@ft/api-database';
import { isPositiveMoney, type Action } from '@ft/shared-contracts';
import { AbilityFactory } from '../../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';

export interface CreateBudgetInput {
  // YYYY-MM.
  month: string;
  categoryId?: string;
  accountId?: string;
  amount: string;
}

export interface BudgetTotals {
  categories: { categoryId: string | null; type: 'expense' | 'income'; currencyId: number; recorded: string; planned: string }[];
  accounts: { accountId: string; recorded: string; planned: string }[];
}

// Expenses and incomes by the top-level category they're filed under — a subcategory's carry their
// parent's id in category_id as well — and the currency they were recorded in. Converting between
// currencies is the client's business, at the rates it shows everywhere else.
const CATEGORY_TOTALS_SQL = `
  SELECT t.category_id AS "categoryId",
         t.type::text AS type,
         t.currency_id AS "currencyId",
         COALESCE(SUM(t.amount) FILTER (WHERE t.date <= now()), 0)::text AS recorded,
         COALESCE(SUM(t.amount) FILTER (WHERE t.date > now()), 0)::text AS planned
  FROM transactions t
  WHERE t.group_id = $1
    AND t.deleted_at IS NULL
    AND t.type IN ('expense', 'income')
    AND t.date >= $2
    AND t.date <= $3
  GROUP BY t.category_id, t.type, t.currency_id
`;

// How much each account's balance moved, through the function the balance trigger itself uses, so
// what goes into a budget's progress can't disagree with what the account shows.
const ACCOUNT_TOTALS_SQL = `
  SELECT a.id AS "accountId",
         COALESCE(SUM(transaction_balance_contribution(
           t.deleted_at, t.type, t.amount, t.dest_amount, t.account_id, t.to_account_id, a.id
         )) FILTER (WHERE t.date <= now()), 0)::text AS recorded,
         COALESCE(SUM(transaction_balance_contribution(
           t.deleted_at, t.type, t.amount, t.dest_amount, t.account_id, t.to_account_id, a.id
         )) FILTER (WHERE t.date > now()), 0)::text AS planned
  FROM accounts a
  JOIN transactions t
    ON (t.account_id = a.id OR t.to_account_id = a.id)
   AND t.deleted_at IS NULL
   AND t.date >= $2
   AND t.date <= $3
  WHERE a.group_id = $1
    AND a.deleted_at IS NULL
  GROUP BY a.id
`;

/**
 * A group's budget, a month at a time: how much is meant to be spent from each expense category,
 * received into each income category, and put into each debt or savings account. Nothing carries
 * over from one month to the next. Lines follow the ledger's own rule, as the table's RLS policies
 * do too: anyone in the group sees them, and anyone who may record money in it may change them.
 */
@Injectable()
export class BudgetsService {
  constructor(
    @InjectRepository(Budget) private readonly budgets: Repository<Budget>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly abilities: AbilityFactory,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  // In the order they were added; the client sorts them as its lists are sorted.
  async list(userId: string, groupId: string, month: string): Promise<Budget[]> {
    await this.authorize(userId, groupId, 'read');
    return this.budgets.find({ where: { groupId, month: firstDayOf(month) }, order: { createdAt: 'ASC', id: 'ASC' } });
  }

  // One after another: the request's RLS transaction holds a single connection.
  async totals(userId: string, groupId: string, dateFrom: string, dateTo: string): Promise<BudgetTotals> {
    await this.authorize(userId, groupId, 'read');
    const categories: BudgetTotals['categories'] = await this.budgets.query(CATEGORY_TOTALS_SQL, [groupId, dateFrom, dateTo]);
    const accounts: BudgetTotals['accounts'] = await this.budgets.query(ACCOUNT_TOTALS_SQL, [groupId, dateFrom, dateTo]);
    return {
      // smallint arrives as a number already; spelled out so a driver change can't turn it into a string.
      categories: categories.map((row) => ({ ...row, currencyId: Number(row.currencyId) })),
      accounts,
    };
  }

  @Transactional()
  async create(userId: string, groupId: string, input: CreateBudgetInput): Promise<Budget> {
    await this.authorize(userId, groupId, 'create');
    assertPositive(input.amount);
    const month = firstDayOf(input.month);
    let currencyId: number;

    if (input.categoryId && !input.accountId) {
      await this.assertBudgetableCategory(groupId, input.categoryId);
      if (await this.budgets.exists({ where: { groupId, month, categoryId: input.categoryId } })) {
        throw new ConflictException('This category already has an amount for that month');
      }
      currencyId = await this.mainCurrencyOf(userId);
    } else if (input.accountId && !input.categoryId) {
      const account = await this.assertBudgetableAccount(groupId, input.accountId);
      if (await this.budgets.exists({ where: { groupId, month, accountId: input.accountId } })) {
        throw new ConflictException('This account already has an amount for that month');
      }
      currencyId = account.currencyId;
    } else {
      throw new BadRequestException('A budget line is for either a category or an account');
    }

    const saved = await this.budgets.save(
      this.budgets.create({
        groupId,
        month,
        categoryId: input.categoryId ?? null,
        accountId: input.accountId ?? null,
        amount: input.amount,
        currencyId,
        createdBy: userId,
      }),
    );
    this.realtime.emitToGroup(groupId, { resourceType: 'Budget', resourceId: saved.id, action: 'created', groupId });
    // Read back rather than returned as saved: the row's month comes back from Postgres as it stores it.
    return this.findOrFail(groupId, saved.id);
  }

  // A category's amount is always in the main currency of whoever typed it: the person changing it
  // now typed it in theirs. An account's stays in the account's currency.
  @Transactional()
  async update(userId: string, groupId: string, budgetId: string, amount: string): Promise<Budget> {
    await this.authorize(userId, groupId, 'update');
    assertPositive(amount);
    const budget = await this.findOrFail(groupId, budgetId);
    const changes: Partial<Pick<Budget, 'amount' | 'currencyId'>> = { amount };
    if (budget.categoryId) {
      changes.currencyId = await this.mainCurrencyOf(userId);
    }
    await this.budgets.update({ id: budgetId, groupId }, changes);
    const updated = await this.findOrFail(groupId, budgetId);
    this.realtime.emitToGroup(groupId, { resourceType: 'Budget', resourceId: budgetId, action: 'updated', groupId });
    return updated;
  }

  @Transactional()
  async remove(userId: string, groupId: string, budgetId: string): Promise<Budget> {
    await this.authorize(userId, groupId, 'delete');
    const budget = await this.findOrFail(groupId, budgetId);
    await this.budgets.delete({ id: budgetId, groupId });
    this.realtime.emitToGroup(groupId, { resourceType: 'Budget', resourceId: budgetId, action: 'deleted', groupId });
    return budget;
  }

  // A top-level category in use. A subcategory's money already counts toward its parent, so a line
  // of its own would count it twice; an archived category isn't offered for new money anywhere.
  private async assertBudgetableCategory(groupId: string, categoryId: string): Promise<void> {
    const category = await this.categories.findOneBy({ id: categoryId, groupId });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    if (category.parentId !== null) {
      throw new BadRequestException(`"${category.name}" is a subcategory: its money counts toward its parent's budget`);
    }
    if (category.archived) {
      throw new BadRequestException(`"${category.name}" is archived`);
    }
  }

  // A debt or savings account in use: those are the ones money is put aside into or paid off on.
  private async assertBudgetableAccount(groupId: string, accountId: string): Promise<Account> {
    const account = await this.accounts.findOneBy({ id: accountId, groupId });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    if (account.type !== 'debt' && account.type !== 'savings') {
      throw new BadRequestException(`"${account.name}" is neither a debt nor a savings account`);
    }
    if (account.archived) {
      throw new BadRequestException(`"${account.name}" is archived`);
    }
    return account;
  }

  private async mainCurrencyOf(userId: string): Promise<number> {
    const profile = await this.profiles.findOneBy({ id: userId });
    if (!profile) {
      throw new BadRequestException('Finish setting up your profile first: amounts are in its main currency');
    }
    return profile.mainCurrencyId;
  }

  private async findOrFail(groupId: string, budgetId: string): Promise<Budget> {
    const budget = await this.budgets.findOneBy({ id: budgetId, groupId });
    if (!budget) {
      throw new NotFoundException('Budget line not found');
    }
    return budget;
  }

  private async authorize(userId: string, groupId: string, action: Action): Promise<void> {
    // Also the 404 for a group the caller isn't in, like every other group-scoped route.
    const { ability } = await this.abilities.forGroup(userId, groupId);
    if (!ability.can(action, 'Budget')) {
      throw new ForbiddenException(`Not allowed to ${action} a budget line`);
    }
  }
}

// Nothing budgeted is no line at all, rather than a line of zero.
function assertPositive(amount: string): void {
  if (!isPositiveMoney(amount)) {
    throw new BadRequestException('A budgeted amount must be above zero');
  }
}

// YYYY-MM as the date column stores it.
function firstDayOf(month: string): string {
  return `${month}-01`;
}
