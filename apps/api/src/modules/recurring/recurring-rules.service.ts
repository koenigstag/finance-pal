import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Account, RecurrenceUnit, RecurringRule, Transaction, TransactionType } from '@ft/api-database';
import {
  RECURRENCE_UNITS,
  TRANSACTION_TYPES,
  type Action,
  type AppAbility,
  type Subject,
} from '@ft/shared-contracts';
import { AbilityFactory } from '../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import {
  TransactionValidator,
  keptPercentage,
  keptPercentageBase,
  keptRoundBalanceTo,
  keptSubcategory,
  type TransactionShape,
} from '../ledger/transactions/transaction-validator';
import { reworkEstimates } from './balance-estimates';
import {
  detachFutureOccurrences,
  materializeOccurrences,
  nextOccurrence,
  plannedOccurrenceDates,
  regenerateOccurrences,
  removeFutureOccurrences,
} from './occurrence-materializer';

// The shared string unions, not api-database's TypeORM enums — see the identical comment on
// GroupWithRole.role in GroupsService for why (assignable one way, not the other).
export interface CreateRecurringRuleInput {
  type: (typeof TRANSACTION_TYPES)[number];
  amount: string;
  currencyId: number;
  accountId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  toAccountId?: string | null;
  note?: string | null;
  percentage?: string | null;
  percentageBase?: string | null;
  roundBalanceTo?: number | null;
  intervalUnit: (typeof RECURRENCE_UNITS)[number];
  intervalValue?: number;
  startsAt: string;
  reminderDaysBefore?: number | null;
  timezone?: string;
  replacesTransactionId?: string;
}

export type UpdateRecurringRuleInput = Partial<Omit<CreateRecurringRuleInput, 'replacesTransactionId'>> & { active?: boolean };

// A rule as the API shows it: with the date its series next produces a transaction.
export interface RecurringRuleView {
  rule: RecurringRule;
  nextOccurrence: Date | null;
}

function shapeOf(rule: RecurringRule): TransactionShape {
  return {
    type: rule.type,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    subcategoryId: rule.subcategoryId,
    toAccountId: rule.toAccountId,
    amount: rule.amount,
    destAmount: null,
    percentage: rule.percentage,
    percentageBase: rule.percentageBase,
    roundBalanceTo: rule.roundBalanceTo,
  };
}

// Fields that change what an occurrence looks like or when it happens. Editing any of them
// regenerates the future occurrences; reminderDaysBefore doesn't touch a single row.
function occurrencesAffected(before: RecurringRule, after: RecurringRule): boolean {
  return (
    before.type !== after.type ||
    before.amount !== after.amount ||
    before.currencyId !== after.currencyId ||
    before.accountId !== after.accountId ||
    before.categoryId !== after.categoryId ||
    before.subcategoryId !== after.subcategoryId ||
    before.toAccountId !== after.toAccountId ||
    before.note !== after.note ||
    // numeric(7,4) reads back padded ("3.5000"), while a patch has it as typed ("3.5").
    (before.percentage === null || after.percentage === null
      ? before.percentage !== after.percentage
      : Number(before.percentage) !== Number(after.percentage)) ||
    before.percentageBase !== after.percentageBase ||
    before.roundBalanceTo !== after.roundBalanceTo ||
    before.intervalUnit !== after.intervalUnit ||
    before.intervalValue !== after.intervalValue ||
    before.startsAt.getTime() !== after.startsAt.getTime() ||
    before.timezone !== after.timezone
  );
}

@Injectable()
export class RecurringRulesService {
  constructor(
    @InjectRepository(RecurringRule) private readonly rules: Repository<RecurringRule>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    private readonly abilities: AbilityFactory,
    private readonly validator: TransactionValidator,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  async list(userId: string, groupId: string, includeInactive: boolean): Promise<RecurringRuleView[]> {
    await this.authorize(userId, groupId, 'read', 'RecurringRule');
    const rules = await this.rules.find({
      where: includeInactive ? { groupId } : { groupId, active: true },
      order: { createdAt: 'ASC' },
    });
    return this.withNextOccurrences(rules);
  }

  async get(userId: string, groupId: string, ruleId: string): Promise<RecurringRuleView> {
    await this.authorize(userId, groupId, 'read', 'RecurringRule');
    return this.viewOf(await this.findOrFail(groupId, ruleId));
  }

  /** Future occurrences whose date falls inside their own rule's reminder window. */
  async upcoming(userId: string, groupId: string): Promise<Transaction[]> {
    await this.authorize(userId, groupId, 'read', 'RecurringRule');
    return this.transactions
      .createQueryBuilder('t')
      .innerJoin('t.recurringRule', 'r')
      .where('t.group_id = :groupId', { groupId })
      .andWhere('t.date > now()')
      .andWhere('r.active = true')
      .andWhere('r.deleted_at IS NULL')
      .andWhere('r.reminder_days_before IS NOT NULL')
      .andWhere('t.date <= now() + make_interval(days => r.reminder_days_before)')
      .orderBy('t.date', 'ASC')
      .getMany();
  }

  @Transactional()
  async create(userId: string, groupId: string, input: CreateRecurringRuleInput): Promise<RecurringRuleView> {
    await this.authorize(userId, groupId, 'create', 'RecurringRule');

    const startsAt = new Date(input.startsAt);
    const rule = this.rules.create({
      groupId,
      type: input.type as TransactionType,
      amount: input.amount,
      currencyId: input.currencyId,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      subcategoryId: input.subcategoryId ?? null,
      toAccountId: input.toAccountId ?? null,
      note: input.note ?? null,
      percentage: input.percentage ?? null,
      percentageBase: input.percentageBase ?? null,
      roundBalanceTo: input.roundBalanceTo ?? null,
      intervalUnit: input.intervalUnit as RecurrenceUnit,
      intervalValue: input.intervalValue ?? 1,
      startsAt,
      nextRunDate: startsAt,
      reminderDaysBefore: input.reminderDaysBefore ?? null,
      timezone: input.timezone ?? 'UTC',
      active: true,
      createdBy: userId,
    });
    // Before the insert: the table's own check constraints and group trigger would reject bad
    // input too, but as a bare 500 instead of a 400/404. The category pair is stored the way the
    // validator settles it (a subcategory sent as the category lands under its parent).
    // A series' own amount is what it came to when saved; from the balance, that may be nothing.
    Object.assign(rule, await this.validator.validate(groupId, shapeOf(rule), { estimate: true }));
    await this.assertOneCurrency(groupId, rule);
    if (input.replacesTransactionId) {
      await this.replacePlanned(userId, groupId, input.replacesTransactionId);
    }

    const saved = await this.rules.save(rule);
    const now = new Date();
    await materializeOccurrences(this.rules.manager, saved, now);
    await this.reworkBalanceAmounts(saved, now);

    this.realtime.emitToGroup(groupId, { resourceType: 'RecurringRule', resourceId: saved.id, action: 'created', groupId });
    return this.viewOf(await this.findOrFail(groupId, saved.id));
  }

  @Transactional()
  async update(userId: string, groupId: string, ruleId: string, patch: UpdateRecurringRuleInput): Promise<RecurringRuleView> {
    await this.authorize(userId, groupId, 'update', 'RecurringRule');
    const before = await this.findOrFail(groupId, ruleId);

    const categoryId = patch.categoryId !== undefined ? patch.categoryId : before.categoryId;
    const percentage = keptPercentage(patch, before);
    const after = this.rules.create({
      ...before,
      type: (patch.type as TransactionType | undefined) ?? before.type,
      amount: patch.amount ?? before.amount,
      currencyId: patch.currencyId ?? before.currencyId,
      accountId: patch.accountId ?? before.accountId,
      categoryId,
      subcategoryId: keptSubcategory(patch, before, categoryId),
      toAccountId: patch.toAccountId !== undefined ? patch.toAccountId : before.toAccountId,
      note: patch.note !== undefined ? patch.note : before.note,
      percentage,
      percentageBase: keptPercentageBase(patch, before, percentage),
      roundBalanceTo: keptRoundBalanceTo(patch, before),
      intervalUnit: (patch.intervalUnit as RecurrenceUnit | undefined) ?? before.intervalUnit,
      intervalValue: patch.intervalValue ?? before.intervalValue,
      startsAt: patch.startsAt !== undefined ? new Date(patch.startsAt) : before.startsAt,
      reminderDaysBefore: patch.reminderDaysBefore !== undefined ? patch.reminderDaysBefore : before.reminderDaysBefore,
      timezone: patch.timezone ?? before.timezone,
      active: patch.active ?? before.active,
    });
    Object.assign(after, await this.validator.validate(groupId, shapeOf(after), { estimate: true }));
    await this.assertOneCurrency(groupId, after);
    await this.rules.save(after);

    const manager = this.rules.manager;
    const now = new Date();
    if (!after.active) {
      // Pausing drops what the series still owns ahead of now, the same as deleting the rule.
      // Occurrences a user edited stay — they adjusted those on purpose.
      if (before.active) {
        await removeFutureOccurrences(manager, ruleId, now);
      }
    } else if (!before.active || occurrencesAffected(before, after)) {
      await regenerateOccurrences(manager, after, now);
    }
    await this.reworkBalanceAmounts(after, now, before);

    this.realtime.emitToGroup(groupId, { resourceType: 'RecurringRule', resourceId: ruleId, action: 'updated', groupId });
    return this.viewOf(await this.findOrFail(groupId, ruleId));
  }

  @Transactional()
  async remove(userId: string, groupId: string, ruleId: string, keepPlanned = false): Promise<RecurringRuleView> {
    await this.authorize(userId, groupId, 'delete', 'RecurringRule');
    const rule = await this.findOrFail(groupId, ruleId);
    const now = new Date();
    if (keepPlanned) {
      await detachFutureOccurrences(this.rules.manager, ruleId, now);
    }
    // Occurrences that already happened are real history and stay; so do future ones a user
    // edited. Everything else ahead of now was only ever a projection of this rule.
    await removeFutureOccurrences(this.rules.manager, ruleId, now);
    await this.rules.softDelete({ id: ruleId, groupId });
    await this.reworkBalanceAmounts(rule, now);
    this.realtime.emitToGroup(groupId, { resourceType: 'RecurringRule', resourceId: ruleId, action: 'deleted', groupId });
    // A deleted series produces nothing more.
    return { rule, nextOccurrence: null };
  }

  /**
   * A planned one-off transaction that a new series takes over goes, so the series' own first
   * occurrence doesn't stand beside it. Only a planned one: what already happened stays as it was.
   */
  private async replacePlanned(userId: string, groupId: string, transactionId: string): Promise<void> {
    await this.authorize(userId, groupId, 'delete', 'Transaction');
    const replaced = await this.transactions.findOneBy({ id: transactionId, groupId });
    if (!replaced) {
      throw new NotFoundException('Transaction not found');
    }
    if (replaced.recurringRuleId !== null) {
      throw new BadRequestException('The transaction already belongs to a series');
    }
    if (replaced.date.getTime() <= Date.now()) {
      throw new BadRequestException('Only a planned transaction can become a series');
    }
    await this.transactions.softDelete({ id: transactionId, groupId });
    this.realtime.emitToGroup(groupId, { resourceType: 'Transaction', resourceId: transactionId, action: 'deleted', groupId });
  }

  /**
   * A transfer series carries one amount, sent and received alike: between accounts in different
   * currencies every occurrence would credit the target with the source's figure in the wrong
   * currency, since the balance trigger reads a missing received amount as "the same".
   */
  /**
   * After the series' occurrences changed: the amounts that come from the balances of the accounts
   * it's on, and was on, and are still estimates follow (see reworkEstimates).
   */
  private async reworkBalanceAmounts(rule: RecurringRule, now: Date, before?: RecurringRule): Promise<void> {
    const accountIds = [rule.accountId, rule.toAccountId, before?.accountId, before?.toAccountId];
    const ids = [...new Set(accountIds.filter((id): id is string => !!id))];
    for (const { id, groupId, action } of await reworkEstimates(this.rules.manager, ids, now)) {
      this.realtime.emitToGroup(groupId, { resourceType: 'Transaction', resourceId: id, action, groupId });
    }
  }

  private async assertOneCurrency(groupId: string, rule: RecurringRule): Promise<void> {
    if (rule.type !== TransactionType.TRANSFER || !rule.toAccountId) {
      return;
    }
    const sides = await this.accounts.findBy({ id: In([rule.accountId, rule.toAccountId]), groupId });
    if (new Set(sides.map((account) => account.currencyId)).size > 1) {
      throw new BadRequestException('A recurring transfer needs both accounts in the same currency');
    }
  }

  private async viewOf(rule: RecurringRule): Promise<RecurringRuleView> {
    const [view] = await this.withNextOccurrences([rule]);
    return view;
  }

  private async withNextOccurrences(rules: RecurringRule[]): Promise<RecurringRuleView[]> {
    const now = new Date();
    const planned = await plannedOccurrenceDates(
      this.rules.manager,
      rules.map((rule) => rule.id),
      now,
    );
    return rules.map((rule) => ({ rule, nextOccurrence: nextOccurrence(rule, planned.get(rule.id), now) }));
  }

  private async findOrFail(groupId: string, ruleId: string): Promise<RecurringRule> {
    const rule = await this.rules.findOneBy({ id: ruleId, groupId });
    if (!rule) {
      throw new NotFoundException('Recurring rule not found');
    }
    return rule;
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
