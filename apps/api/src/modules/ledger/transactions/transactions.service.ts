import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { RecurringRule, Tag, Transaction, TransactionTag, TransactionType } from '@ft/api-database';
import { TRANSACTION_TYPES, type Action, type AppAbility, type Subject } from '@ft/shared-contracts';
import { AbilityFactory } from '../../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';
import { reworkEstimates } from '../../recurring/balance-estimates';
import { materializeOccurrences } from '../../recurring/occurrence-materializer';
import { decodeCursor, encodeCursor } from './cursor.util';
import {
  TransactionValidator,
  keptPercentage,
  keptPercentageAsOf,
  keptPercentageBase,
  keptRoundBalanceTo,
  keptSubcategory,
} from './transaction-validator';

// The shared string union, not api-database's TypeORM enum — see the identical comment on
// GroupWithRole.role in GroupsService for why (assignable one way, not the other).
export interface CreateTransactionInput {
  type: (typeof TRANSACTION_TYPES)[number];
  date: string;
  amount: string;
  currencyId: number;
  accountId: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  toAccountId?: string | null;
  destAmount?: string | null;
  percentage?: string | null;
  percentageBase?: string | null;
  roundBalanceTo?: number | null;
  note?: string;
  tagIds?: string[];
}

export type UpdateTransactionInput = Partial<CreateTransactionInput>;

// Stored with a transaction the external API records for a request carrying an idempotency key,
// both as sha256 digests: the key, unique per group, and what the request asked for. See
// ExternalTransactionsService for how a repeat finds them.
export interface TransactionIdempotency {
  key: string;
  fingerprint: string;
}

export interface ListTransactionsFilter {
  cursor?: string;
  limit?: number;
  accountId?: string;
  categoryId?: string;
  tagId?: string;
  type?: (typeof TRANSACTION_TYPES)[number];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export interface TransactionPage {
  items: Transaction[];
  tagsByTransactionId: Map<string, string[]>;
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionTag) private readonly transactionTags: Repository<TransactionTag>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(RecurringRule) private readonly rules: Repository<RecurringRule>,
    private readonly abilities: AbilityFactory,
    private readonly realtime: RealtimeEmitterService,
    private readonly validator: TransactionValidator,
  ) {}

  async list(userId: string, groupId: string, filter: ListTransactionsFilter): Promise<TransactionPage> {
    await this.authorize(userId, groupId, 'read', 'Transaction');

    const limit = filter.limit ?? DEFAULT_LIMIT;
    const qb = this.transactions.createQueryBuilder('t').where('t.group_id = :groupId', { groupId });

    if (filter.cursor) {
      const cursor = decodeCursor(filter.cursor);
      if (!cursor) {
        throw new BadRequestException('Invalid cursor');
      }
      qb.andWhere('(t.date, t.id) < (:cursorDate, :cursorId)', { cursorDate: cursor.date, cursorId: cursor.id });
    }
    if (filter.accountId) {
      qb.andWhere('t.account_id = :accountId', { accountId: filter.accountId });
    }
    if (filter.categoryId) {
      // Either column: a category holds its subcategories' transactions too, in category_id.
      qb.andWhere('(t.category_id = :categoryId OR t.subcategory_id = :categoryId)', { categoryId: filter.categoryId });
    }
    if (filter.type) {
      qb.andWhere('t.type = :type', { type: filter.type });
    }
    if (filter.dateFrom) {
      qb.andWhere('t.date >= :dateFrom', { dateFrom: filter.dateFrom });
    }
    if (filter.dateTo) {
      qb.andWhere('t.date <= :dateTo', { dateTo: filter.dateTo });
    }
    if (filter.search) {
      qb.andWhere('t.note ILIKE :search', { search: `%${filter.search}%` });
    }
    if (filter.tagId) {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = :tagId)',
        { tagId: filter.tagId },
      );
    }

    const rows = await qb.orderBy('t.date', 'DESC').addOrderBy('t.id', 'DESC').take(limit + 1).getMany();

    let nextCursor: string | null = null;
    if (rows.length > limit) {
      rows.length = limit;
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor(last.date, last.id);
    }

    return { items: rows, tagsByTransactionId: await this.loadTagIds(rows.map((r) => r.id)), nextCursor };
  }

  async get(userId: string, groupId: string, transactionId: string): Promise<{ transaction: Transaction; tagIds: string[] }> {
    await this.authorize(userId, groupId, 'read', 'Transaction');
    const transaction = await this.findOrFail(groupId, transactionId);
    const tagsByTransactionId = await this.loadTagIds([transactionId]);
    return { transaction, tagIds: tagsByTransactionId.get(transactionId) ?? [] };
  }

  @Transactional()
  async create(
    userId: string,
    groupId: string,
    input: CreateTransactionInput,
    idempotency?: TransactionIdempotency,
  ): Promise<{ transaction: Transaction; tagIds: string[] }> {
    await this.authorize(userId, groupId, 'create', 'Transaction');

    const merged = {
      type: input.type as TransactionType,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      subcategoryId: input.subcategoryId ?? null,
      toAccountId: input.toAccountId ?? null,
      amount: input.amount,
      destAmount: input.destAmount ?? null,
      percentage: input.percentage ?? null,
      percentageBase: input.percentageBase ?? null,
      roundBalanceTo: input.roundBalanceTo ?? null,
    };
    const filed = await this.validator.validate(groupId, merged);
    const tagIds = await this.assertTagsValid(groupId, input.tagIds);

    const date = new Date(input.date);
    const now = new Date();
    const created = await this.transactions.save(
      this.transactions.create({
        groupId,
        type: merged.type,
        date,
        amount: input.amount,
        currencyId: input.currencyId,
        accountId: input.accountId,
        categoryId: filed.categoryId,
        subcategoryId: filed.subcategoryId,
        toAccountId: merged.toAccountId,
        destAmount: merged.destAmount,
        percentage: merged.percentage,
        percentageBase: merged.percentageBase,
        roundBalanceTo: merged.roundBalanceTo,
        percentageAsOf: keptPercentageAsOf(null, merged, date, now),
        note: input.note ?? null,
        // Explicit, not left to column defaults: save() returns this object, and an omitted
        // nullable column comes back undefined, which the contract's .nullable() rejects.
        recurringRuleId: null,
        recurrenceDate: null,
        isCustomized: false,
        idempotencyKey: idempotency?.key ?? null,
        idempotencyFingerprint: idempotency?.fingerprint ?? null,
        createdBy: userId,
      }),
    );

    if (tagIds.length > 0) {
      await this.transactionTags.save(tagIds.map((tagId) => this.transactionTags.create({ transactionId: created.id, tagId })));
    }

    const reworked = await this.reworkBalanceAmounts([merged.accountId, merged.toAccountId], created.id, now);
    // Planned and from the balance, it's worked out again from the balance its date will have,
    // which may not be the figure it was sent with.
    const transaction = reworked.has(created.id) ? await this.findOrFail(groupId, created.id) : created;

    this.realtime.emitToGroup(groupId, {
      resourceType: 'Transaction',
      resourceId: transaction.id,
      action: 'created',
      groupId,
    });
    return { transaction, tagIds };
  }

  @Transactional()
  async update(
    userId: string,
    groupId: string,
    transactionId: string,
    patch: UpdateTransactionInput,
  ): Promise<{ transaction: Transaction; tagIds: string[] }> {
    await this.authorize(userId, groupId, 'update', 'Transaction');
    const existing = await this.findOrFail(groupId, transactionId);
    // The type is chosen when a transaction is recorded: an income never turns into a transfer.
    if (patch.type !== undefined && patch.type !== existing.type) {
      throw new BadRequestException('A transaction type cannot be changed');
    }

    const categoryId = patch.categoryId !== undefined ? patch.categoryId : existing.categoryId;
    const percentage = keptPercentage(patch, existing);
    const merged = {
      type: (patch.type as TransactionType | undefined) ?? existing.type,
      accountId: patch.accountId ?? existing.accountId,
      categoryId,
      subcategoryId: keptSubcategory(patch, existing, categoryId),
      toAccountId: patch.toAccountId !== undefined ? patch.toAccountId : existing.toAccountId,
      amount: patch.amount ?? existing.amount,
      destAmount: patch.destAmount !== undefined ? patch.destAmount : existing.destAmount,
      percentage,
      percentageBase: keptPercentageBase(patch, existing, percentage),
      roundBalanceTo: keptRoundBalanceTo(patch, existing),
    };
    const filed = await this.validator.validate(groupId, merged);

    const patchedTagIds = patch.tagIds !== undefined ? await this.assertTagsValid(groupId, patch.tagIds) : undefined;

    const date = patch.date !== undefined ? new Date(patch.date) : existing.date;
    const now = new Date();
    // Every field below is fully resolved (existing value or patch override), never `undefined`
    // — passing `undefined` into a TypeORM partial update is unreliable to reason about, so the
    // safe rule here is: always write a concrete value.
    await this.transactions.update(
      { id: transactionId, groupId },
      {
        type: merged.type,
        date,
        amount: merged.amount,
        currencyId: patch.currencyId ?? existing.currencyId,
        accountId: merged.accountId,
        categoryId: filed.categoryId,
        subcategoryId: filed.subcategoryId,
        toAccountId: merged.toAccountId,
        destAmount: merged.destAmount,
        percentage: merged.percentage,
        percentageBase: merged.percentageBase,
        roundBalanceTo: merged.roundBalanceTo,
        percentageAsOf: keptPercentageAsOf(existing, merged, date, now),
        note: patch.note !== undefined ? patch.note : existing.note,
        // Editing one occurrence of a series directly pins it: regenerating the series after a
        // rule change replaces only occurrences nobody has touched.
        isCustomized: existing.recurringRuleId !== null || existing.isCustomized,
      },
    );

    if (patchedTagIds !== undefined) {
      await this.transactionTags.delete({ transactionId });
      if (patchedTagIds.length > 0) {
        await this.transactionTags.save(
          patchedTagIds.map((tagId) => this.transactionTags.create({ transactionId, tagId })),
        );
      }
    }
    await this.keepSeriesGoing(existing.recurringRuleId);
    // Both the accounts it was on and the ones it's on now: moving it changes the balance of each.
    const reworked = await this.reworkBalanceAmounts(
      [existing.accountId, existing.toAccountId, merged.accountId, merged.toAccountId],
      transactionId,
      now,
    );
    // A planned amount from the balance brought to today lands, and is worked out a last time,
    // which can come to nothing: then nothing was charged, and it's gone.
    const gone = reworked.get(transactionId) === 'deleted';

    const transaction = await this.findOrFail(groupId, transactionId, gone);
    const tagIds = patchedTagIds ?? (await this.loadTagIds([transactionId])).get(transactionId) ?? [];
    this.realtime.emitToGroup(groupId, {
      resourceType: 'Transaction',
      resourceId: transactionId,
      action: gone ? 'deleted' : 'updated',
      groupId,
    });
    return { transaction, tagIds };
  }

  @Transactional()
  async remove(userId: string, groupId: string, transactionId: string): Promise<{ transaction: Transaction; tagIds: string[] }> {
    await this.authorize(userId, groupId, 'delete', 'Transaction');
    const transaction = await this.findOrFail(groupId, transactionId);
    const tagIds = (await this.loadTagIds([transactionId])).get(transactionId) ?? [];
    await this.transactions.softDelete({ id: transactionId, groupId });
    await this.keepSeriesGoing(transaction.recurringRuleId);
    await this.reworkBalanceAmounts([transaction.accountId, transaction.toAccountId], transactionId, new Date());
    this.realtime.emitToGroup(groupId, {
      resourceType: 'Transaction',
      resourceId: transactionId,
      action: 'deleted',
      groupId,
    });
    return { transaction, tagIds };
  }

  /**
   * A series keeps one planned occurrence. Deleting that one skips it, and moving it to a date
   * that has passed makes it land early; either way the series has none left, and its next one is
   * written here, as part of the same change, rather than on the scheduler's next run.
   */
  private async keepSeriesGoing(ruleId: string | null): Promise<void> {
    if (!ruleId) {
      return;
    }
    const rule = await this.rules.findOneBy({ id: ruleId, active: true });
    if (rule) {
      await materializeOccurrences(this.rules.manager, rule, new Date());
    }
  }

  /**
   * After a write that moves these accounts' balances: the amounts that come from them and are
   * still estimates follow (see reworkEstimates), and the groups hear of each but `own`, which the
   * write reports itself. Returns what was reworked.
   */
  private async reworkBalanceAmounts(
    accountIds: (string | null)[],
    own: string,
    now: Date,
  ): Promise<Map<string, 'updated' | 'deleted'>> {
    const ids = [...new Set(accountIds.filter((id): id is string => id !== null))];
    const reworked = await reworkEstimates(this.transactions.manager, ids, now);
    for (const { id, groupId, action } of reworked) {
      if (id !== own) {
        this.realtime.emitToGroup(groupId, { resourceType: 'Transaction', resourceId: id, action, groupId });
      }
    }
    return new Map(reworked.map(({ id, action }) => [id, action]));
  }


  private async assertTagsValid(groupId: string, tagIds: string[] | undefined): Promise<string[]> {
    if (!tagIds || tagIds.length === 0) {
      return [];
    }
    const uniqueTagIds = [...new Set(tagIds)];
    const count = await this.tags.count({ where: { id: In(uniqueTagIds), groupId } });
    if (count !== uniqueTagIds.length) {
      throw new NotFoundException('One or more tags not found');
    }
    return uniqueTagIds;
  }

  private async loadTagIds(transactionIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (transactionIds.length === 0) {
      return map;
    }
    const rows = await this.transactionTags.find({ where: { transactionId: In(transactionIds) } });
    for (const row of rows) {
      const list = map.get(row.transactionId) ?? [];
      list.push(row.tagId);
      map.set(row.transactionId, list);
    }
    return map;
  }

  private async findOrFail(groupId: string, transactionId: string, withDeleted = false): Promise<Transaction> {
    const transaction = await this.transactions.findOne({ where: { id: transactionId, groupId }, withDeleted });
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }
    return transaction;
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
