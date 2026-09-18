import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { RecurrenceUnit, RecurringRule, Transaction, TransactionType } from '@ft/api-database';
import {
  RECURRENCE_UNITS,
  TRANSACTION_TYPES,
  type Action,
  type AppAbility,
  type Subject,
} from '@ft/shared-contracts';
import { AbilityFactory } from '../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { TransactionValidator, keptSubcategory, type TransactionShape } from '../ledger/transactions/transaction-validator';
import { materializeOccurrences, regenerateOccurrences, removeFutureOccurrences } from './occurrence-materializer';

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
  intervalUnit: (typeof RECURRENCE_UNITS)[number];
  intervalValue?: number;
  startsAt: string;
  reminderDaysBefore?: number | null;
  timezone?: string;
}

export type UpdateRecurringRuleInput = Partial<CreateRecurringRuleInput> & { active?: boolean };

function shapeOf(rule: RecurringRule): TransactionShape {
  return {
    type: rule.type,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    subcategoryId: rule.subcategoryId,
    toAccountId: rule.toAccountId,
    amount: rule.amount,
    destAmount: null,
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
    private readonly abilities: AbilityFactory,
    private readonly validator: TransactionValidator,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  async list(userId: string, groupId: string, includeInactive: boolean): Promise<RecurringRule[]> {
    await this.authorize(userId, groupId, 'read', 'RecurringRule');
    return this.rules.find({
      where: includeInactive ? { groupId } : { groupId, active: true },
      order: { createdAt: 'ASC' },
    });
  }

  async get(userId: string, groupId: string, ruleId: string): Promise<RecurringRule> {
    await this.authorize(userId, groupId, 'read', 'RecurringRule');
    return this.findOrFail(groupId, ruleId);
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
  async create(userId: string, groupId: string, input: CreateRecurringRuleInput): Promise<RecurringRule> {
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
    Object.assign(rule, await this.validator.validate(groupId, shapeOf(rule)));

    const saved = await this.rules.save(rule);
    await materializeOccurrences(this.rules.manager, saved, new Date());

    this.realtime.emitToGroup(groupId, { resourceType: 'RecurringRule', resourceId: saved.id, action: 'created', groupId });
    return this.findOrFail(groupId, saved.id);
  }

  @Transactional()
  async update(userId: string, groupId: string, ruleId: string, patch: UpdateRecurringRuleInput): Promise<RecurringRule> {
    await this.authorize(userId, groupId, 'update', 'RecurringRule');
    const before = await this.findOrFail(groupId, ruleId);

    const categoryId = patch.categoryId !== undefined ? patch.categoryId : before.categoryId;
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
      intervalUnit: (patch.intervalUnit as RecurrenceUnit | undefined) ?? before.intervalUnit,
      intervalValue: patch.intervalValue ?? before.intervalValue,
      startsAt: patch.startsAt !== undefined ? new Date(patch.startsAt) : before.startsAt,
      reminderDaysBefore: patch.reminderDaysBefore !== undefined ? patch.reminderDaysBefore : before.reminderDaysBefore,
      timezone: patch.timezone ?? before.timezone,
      active: patch.active ?? before.active,
    });
    Object.assign(after, await this.validator.validate(groupId, shapeOf(after)));
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

    this.realtime.emitToGroup(groupId, { resourceType: 'RecurringRule', resourceId: ruleId, action: 'updated', groupId });
    return this.findOrFail(groupId, ruleId);
  }

  @Transactional()
  async remove(userId: string, groupId: string, ruleId: string): Promise<RecurringRule> {
    await this.authorize(userId, groupId, 'delete', 'RecurringRule');
    const rule = await this.findOrFail(groupId, ruleId);
    // Occurrences that already happened are real history and stay; so do future ones a user
    // edited. Everything else ahead of now was only ever a projection of this rule.
    await removeFutureOccurrences(this.rules.manager, ruleId, new Date());
    await this.rules.softDelete({ id: ruleId, groupId });
    this.realtime.emitToGroup(groupId, { resourceType: 'RecurringRule', resourceId: ruleId, action: 'deleted', groupId });
    return rule;
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
