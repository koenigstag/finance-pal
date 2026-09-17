import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Account, AccountTarget, AccountType, RecurringRule, Transaction } from '@ft/api-database';
import { ACCOUNT_TYPES, type Action, type AppAbility, type Subject } from '@ft/shared-contracts';
import { AbilityFactory } from '../../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';

// The shared string union, not api-database's TypeORM enum — see the identical comment on
// GroupWithRole.role in GroupsService for why (assignable one way, not the other).
export interface CreateAccountInput {
  type?: (typeof ACCOUNT_TYPES)[number];
  name: string;
  currencyId: number;
  isFavourite?: boolean;
  icon?: string | null;
  color?: string | null;
  description?: string;
  isIncludedInBalance?: boolean;
  sortOrder?: number;
}

export type UpdateAccountInput = Partial<CreateAccountInput>;

export interface AccountUsage {
  transactionCount: number;
  plannedTransactionCount: number;
  recurringRuleCount: number;
}

export interface UpsertAccountTargetInput {
  limitAmount?: string | null;
  goalAmount?: string | null;
}

export interface AccountWithBalance {
  account: Account;
  // Excludes future-dated transactions; account.cachedBalance includes them. See withBalances().
  balance: string;
}

// cached_balance is kept up to date by a trigger on transactions, which fires on insert/update/
// delete only. A future-dated transaction becoming a past one is not a database event, so a
// date filter inside that trigger would leave balances permanently stale. Instead the trigger
// keeps summing everything, and the not-yet-happened tail is subtracted here on read — through
// the very function the trigger uses, so the two can't disagree about what a row contributes.
// Arithmetic stays in Postgres numeric; the result arrives as a string, never a JS float.
const BALANCES_EXCLUDING_FUTURE_SQL = `
  SELECT a.id,
         (a.cached_balance - COALESCE(SUM(transaction_balance_contribution(
            t.deleted_at, t.type, t.amount, t.dest_amount, t.account_id, t.to_account_id, a.id
         )), 0))::numeric(14, 2)::text AS balance
  FROM accounts a
  LEFT JOIN transactions t
    ON (t.account_id = a.id OR t.to_account_id = a.id)
   AND t.date > now()
   AND t.deleted_at IS NULL
  WHERE a.id = ANY($1::uuid[])
  GROUP BY a.id, a.cached_balance
`;

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(AccountTarget) private readonly targets: Repository<AccountTarget>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(RecurringRule) private readonly recurringRules: Repository<RecurringRule>,
    private readonly abilities: AbilityFactory,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  async list(userId: string, groupId: string, includeArchived: boolean): Promise<AccountWithBalance[]> {
    await this.authorize(userId, groupId, 'read', 'Account');
    const accounts = await this.accounts.find({
      where: includeArchived ? { groupId } : { groupId, archived: false },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return this.withBalances(accounts);
  }

  async get(userId: string, groupId: string, accountId: string): Promise<AccountWithBalance> {
    await this.authorize(userId, groupId, 'read', 'Account');
    return this.withBalance(await this.findOrFail(groupId, accountId));
  }

  @Transactional()
  async create(userId: string, groupId: string, input: CreateAccountInput): Promise<AccountWithBalance> {
    await this.authorize(userId, groupId, 'create', 'Account');
    const account = this.accounts.create({
      ...input,
      type: input.type as AccountType | undefined,
      groupId,
      createdBy: userId,
    });
    const saved = await this.accounts.save(account);
    if (input.isFavourite) {
      await this.clearOtherFavourites(groupId, saved.id);
    }
    this.realtime.emitToGroup(groupId, { resourceType: 'Account', resourceId: saved.id, action: 'created', groupId });
    return this.withBalance(saved);
  }

  @Transactional()
  async update(
    userId: string,
    groupId: string,
    accountId: string,
    patch: UpdateAccountInput,
  ): Promise<AccountWithBalance> {
    await this.authorize(userId, groupId, 'update', 'Account');
    await this.findOrFail(groupId, accountId);
    await this.accounts.update({ id: accountId, groupId }, { ...patch, type: patch.type as AccountType | undefined });
    if (patch.isFavourite) {
      await this.clearOtherFavourites(groupId, accountId);
    }
    const updated = await this.findOrFail(groupId, accountId);
    this.realtime.emitToGroup(groupId, { resourceType: 'Account', resourceId: accountId, action: 'updated', groupId });
    return this.withBalance(updated);
  }

  // A group has at most one favourite account — the one new transactions start on — so marking
  // one unmarks the rest. The other rows' change reaches clients with this request's Account event.
  private async clearOtherFavourites(groupId: string, favouriteId: string): Promise<void> {
    await this.accounts.update({ groupId, id: Not(favouriteId), isFavourite: true }, { isFavourite: false });
  }

  @Transactional()
  async archive(userId: string, groupId: string, accountId: string): Promise<AccountWithBalance> {
    await this.authorize(userId, groupId, 'update', 'Account');
    await this.findOrFail(groupId, accountId);
    await this.accounts.update({ id: accountId, groupId }, { archived: true, archivedAt: new Date() });
    const account = await this.findOrFail(groupId, accountId);
    this.realtime.emitToGroup(groupId, { resourceType: 'Account', resourceId: accountId, action: 'archived', groupId });
    return this.withBalance(account);
  }

  @Transactional()
  async restore(userId: string, groupId: string, accountId: string): Promise<AccountWithBalance> {
    await this.authorize(userId, groupId, 'update', 'Account');
    await this.findOrFail(groupId, accountId);
    await this.accounts.update({ id: accountId, groupId }, { archived: false, archivedAt: null });
    const account = await this.findOrFail(groupId, accountId);
    this.realtime.emitToGroup(groupId, { resourceType: 'Account', resourceId: accountId, action: 'restored', groupId });
    return this.withBalance(account);
  }

  @Transactional()
  async usage(userId: string, groupId: string, accountId: string): Promise<AccountUsage> {
    await this.authorize(userId, groupId, 'read', 'Account');
    await this.findOrFail(groupId, accountId);
    // One after another: the request's RLS transaction holds a single connection.
    const now = new Date();
    const transactionCount = await this.referencing(this.transactions, groupId, accountId).andWhere('date <= :now', { now }).getCount();
    const plannedTransactionCount = await this.referencing(this.transactions, groupId, accountId).andWhere('date > :now', { now }).getCount();
    const recurringRuleCount = await this.referencing(this.recurringRules, groupId, accountId).getCount();
    return { transactionCount, plannedTransactionCount, recurringRuleCount };
  }

  /**
   * Deletes the account and everything that only makes sense with it: its transactions, including
   * transfers from or to it (so the other account's balance loses that transfer too), and the
   * recurring rules using it, which would otherwise keep failing to materialize occurrences.
   * All soft deletes, in one database transaction.
   */
  @Transactional()
  async remove(userId: string, groupId: string, accountId: string): Promise<AccountWithBalance> {
    await this.authorize(userId, groupId, 'delete', 'Account');
    await this.authorize(userId, groupId, 'delete', 'Transaction');
    await this.authorize(userId, groupId, 'delete', 'RecurringRule');
    const result = await this.withBalance(await this.findOrFail(groupId, accountId));

    // Rules first: the scheduler locks a rule while it materializes occurrences, so deleting the
    // rule waits for (or blocks) a run that could otherwise add a transaction after the next step.
    await this.referencing(this.recurringRules, groupId, accountId).softDelete().execute();
    // Balances follow on their own: the transactions trigger counts a deleted row as zero.
    await this.referencing(this.transactions, groupId, accountId).softDelete().execute();
    await this.accounts.softDelete({ id: accountId, groupId });
    this.realtime.emitToGroup(groupId, { resourceType: 'Account', resourceId: accountId, action: 'deleted', groupId });
    return result;
  }

  // Live rows of a transactions-shaped table that draw from or pay into the account. Already
  // deleted ones are left out, so deleting the account doesn't overwrite when they were deleted.
  private referencing<T extends Transaction | RecurringRule>(repository: Repository<T>, groupId: string, accountId: string) {
    return repository
      .createQueryBuilder('row')
      .where('group_id = :groupId', { groupId })
      .andWhere('(account_id = :accountId OR to_account_id = :accountId)', { accountId })
      .andWhere('deleted_at IS NULL');
  }

  @Transactional()
  async upsertTarget(
    userId: string,
    groupId: string,
    accountId: string,
    input: UpsertAccountTargetInput,
  ): Promise<AccountTarget> {
    await this.authorize(userId, groupId, 'update', 'AccountTarget');
    await this.findOrFail(groupId, accountId);

    const existing = await this.targets.findOneBy({ accountId });
    const target = this.targets.create({
      accountId,
      limitAmount: input.limitAmount !== undefined ? input.limitAmount : (existing?.limitAmount ?? null),
      goalAmount: input.goalAmount !== undefined ? input.goalAmount : (existing?.goalAmount ?? null),
    });
    const saved = await this.targets.save(target);
    this.realtime.emitToGroup(groupId, {
      resourceType: 'AccountTarget',
      resourceId: accountId,
      action: 'updated',
      groupId,
    });
    return saved;
  }

  private async withBalance(account: Account): Promise<AccountWithBalance> {
    const [result] = await this.withBalances([account]);
    return result;
  }

  private async withBalances(accounts: Account[]): Promise<AccountWithBalance[]> {
    if (accounts.length === 0) {
      return [];
    }
    const rows: { id: string; balance: string }[] = await this.accounts.query(BALANCES_EXCLUDING_FUTURE_SQL, [
      accounts.map((account) => account.id),
    ]);
    const balanceById = new Map(rows.map((row) => [row.id, row.balance]));
    // Every id was just read from accounts inside this same transaction, so each has a row.
    return accounts.map((account) => ({ account, balance: balanceById.get(account.id) as string }));
  }

  private async findOrFail(groupId: string, accountId: string): Promise<Account> {
    const account = await this.accounts.findOneBy({ id: accountId, groupId });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  private async authorize(userId: string, groupId: string, action: Action, subject: Subject): Promise<void> {
    const ctx = await this.abilities.forGroup(userId, groupId);
    assertCan(ctx.ability, action, subject);
  }
}

function assertCan(ability: AppAbility, action: Action, subject: Subject): void {
  if (!ability.can(action, subject)) {
    throw new ForbiddenException(`Not allowed to ${action} ${subject}`);
  }
}
