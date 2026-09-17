import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Tag, Transaction, TransactionTag, TransactionType } from '@ft/api-database';
import { TRANSACTION_TYPES, type Action, type AppAbility, type Subject } from '@ft/shared-contracts';
import { AbilityFactory } from '../../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';
import { decodeCursor, encodeCursor } from './cursor.util';
import { TransactionValidator } from './transaction-validator';

// The shared string union, not api-database's TypeORM enum — see the identical comment on
// GroupWithRole.role in GroupsService for why (assignable one way, not the other).
export interface CreateTransactionInput {
  type: (typeof TRANSACTION_TYPES)[number];
  date: string;
  amount: string;
  currencyId: number;
  accountId: string;
  categoryId?: string | null;
  toAccountId?: string | null;
  destAmount?: string | null;
  note?: string;
  tagIds?: string[];
}

export type UpdateTransactionInput = Partial<CreateTransactionInput>;

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
      qb.andWhere('t.category_id = :categoryId', { categoryId: filter.categoryId });
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
  async create(userId: string, groupId: string, input: CreateTransactionInput): Promise<{ transaction: Transaction; tagIds: string[] }> {
    await this.authorize(userId, groupId, 'create', 'Transaction');

    const merged = {
      type: input.type as TransactionType,
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      toAccountId: input.toAccountId ?? null,
      amount: input.amount,
      destAmount: input.destAmount ?? null,
    };
    await this.validator.assertValid(groupId, merged);
    const tagIds = await this.assertTagsValid(groupId, input.tagIds);

    const transaction = await this.transactions.save(
      this.transactions.create({
        groupId,
        type: merged.type,
        date: new Date(input.date),
        amount: input.amount,
        currencyId: input.currencyId,
        accountId: input.accountId,
        categoryId: merged.categoryId,
        toAccountId: merged.toAccountId,
        destAmount: merged.destAmount,
        note: input.note ?? null,
        // Explicit, not left to column defaults: save() returns this object, and an omitted
        // nullable column comes back undefined, which the contract's .nullable() rejects.
        recurringRuleId: null,
        recurrenceDate: null,
        isCustomized: false,
        createdBy: userId,
      }),
    );

    if (tagIds.length > 0) {
      await this.transactionTags.save(tagIds.map((tagId) => this.transactionTags.create({ transactionId: transaction.id, tagId })));
    }

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

    const merged = {
      type: (patch.type as TransactionType | undefined) ?? existing.type,
      accountId: patch.accountId ?? existing.accountId,
      categoryId: patch.categoryId !== undefined ? patch.categoryId : existing.categoryId,
      toAccountId: patch.toAccountId !== undefined ? patch.toAccountId : existing.toAccountId,
      amount: patch.amount ?? existing.amount,
      destAmount: patch.destAmount !== undefined ? patch.destAmount : existing.destAmount,
    };
    await this.validator.assertValid(groupId, merged);

    const patchedTagIds = patch.tagIds !== undefined ? await this.assertTagsValid(groupId, patch.tagIds) : undefined;

    // Every field below is fully resolved (existing value or patch override), never `undefined`
    // — passing `undefined` into a TypeORM partial update is unreliable to reason about, so the
    // safe rule here is: always write a concrete value.
    await this.transactions.update(
      { id: transactionId, groupId },
      {
        type: merged.type,
        date: patch.date !== undefined ? new Date(patch.date) : existing.date,
        amount: merged.amount,
        currencyId: patch.currencyId ?? existing.currencyId,
        accountId: merged.accountId,
        categoryId: merged.categoryId,
        toAccountId: merged.toAccountId,
        destAmount: merged.destAmount,
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

    const transaction = await this.findOrFail(groupId, transactionId);
    const tagIds = patchedTagIds ?? (await this.loadTagIds([transactionId])).get(transactionId) ?? [];
    this.realtime.emitToGroup(groupId, {
      resourceType: 'Transaction',
      resourceId: transactionId,
      action: 'updated',
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
    this.realtime.emitToGroup(groupId, {
      resourceType: 'Transaction',
      resourceId: transactionId,
      action: 'deleted',
      groupId,
    });
    return { transaction, tagIds };
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

  private async findOrFail(groupId: string, transactionId: string): Promise<Transaction> {
    const transaction = await this.transactions.findOneBy({ id: transactionId, groupId });
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
