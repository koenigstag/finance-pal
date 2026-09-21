import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Account, Currency, RecurringRule, Tag, Transaction, TransactionTag, TransactionType } from '@ft/api-database';
import { TRANSACTION_TYPES, type Action, type AppAbility, type Subject } from '@ft/shared-contracts';
import { AbilityFactory, type GroupAuthzContext } from '../../_core/authz/ability.factory';
import { PushNotificationsService } from '../../push/push-notifications.service';
import { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';
import { reworkEstimates } from '../../recurring/balance-estimates';
import { materializeOccurrences } from '../../recurring/occurrence-materializer';
import { reworkRateEstimates } from '../../recurring/rate-estimates';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { decodeCursor, encodeCursor } from './cursor.util';
import { convertedDest, planDestAmount, type StoredDest } from './dest-amount';
import {
  TransactionValidator,
  keptPercentage,
  keptPercentageAsOf,
  keptPercentageBase,
  keptRoundBalanceTo,
  keptSubcategory,
  type Validated,
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

// An amount from the balance worked out before its date: a planned one, still to follow its account.
function isEstimate(asOf: Date | null, date: Date): boolean {
  return asOf !== null && asOf.getTime() < date.getTime();
}

@Injectable()
export class TransactionsService {
  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionTag) private readonly transactionTags: Repository<TransactionTag>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(RecurringRule) private readonly rules: Repository<RecurringRule>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Currency) private readonly currencies: Repository<Currency>,
    private readonly abilities: AbilityFactory,
    private readonly realtime: RealtimeEmitterService,
    private readonly push: PushNotificationsService,
    private readonly validator: TransactionValidator,
    private readonly rates: ExchangeRatesService,
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
    const { groupName } = await this.authorize(userId, groupId, 'create', 'Transaction');

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
    const date = new Date(input.date);
    const now = new Date();
    const asOf = keptPercentageAsOf(null, merged, date, now);
    const filed = await this.validator.validate(groupId, merged, { estimate: isEstimate(asOf, date) });
    const dest = await this.settleDest(merged, filed, input.destAmount, null, date, now);
    const tagIds = await this.assertTagsValid(groupId, input.tagIds);

    const created = await this.transactions.save(
      this.transactions.create({
        groupId,
        type: merged.type,
        date,
        amount: input.amount,
        // Its account's, whatever the request says: an amount is only ever in the currency of the
        // account it moves, and that's what the balances read it as.
        currencyId: filed.currencyId,
        accountId: input.accountId,
        categoryId: filed.categoryId,
        subcategoryId: filed.subcategoryId,
        toAccountId: merged.toAccountId,
        destAmount: dest.destAmount,
        destAmountAsOf: dest.destAmountAsOf,
        percentage: merged.percentage,
        percentageBase: merged.percentageBase,
        roundBalanceTo: merged.roundBalanceTo,
        percentageAsOf: asOf,
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
    // Everyone else in the group hears about money that has moved, on whatever device they have
    // registered. Only when it's recorded: an edit or a deletion afterwards is the socket's to
    // report, to whoever is looking. Only when it has happened, too — a transaction written for a
    // date ahead is a plan, and a plan the scheduler follows is announced when it lands instead.
    if (transaction.date.getTime() <= now.getTime()) {
      await this.push.transactionRecorded({
        groupId,
        groupName,
        actorUserId: userId,
        type: transaction.type,
        amount: transaction.amount,
        currencyId: transaction.currencyId,
      });
    }
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
    const date = patch.date !== undefined ? new Date(patch.date) : existing.date;
    const now = new Date();
    // Still an estimate after this, it may come to nothing for now — brought to today by Add now
    // too, which lands it below and drops it if it still does.
    const asOf = keptPercentageAsOf(existing, merged, date, now);
    const filed = await this.validator.validate(groupId, merged, { estimate: isEstimate(asOf, date) });
    const stored: StoredDest = {
      destAmount: existing.destAmount,
      destAmountAsOf: existing.destAmountAsOf,
      sameCurrencies: await this.sameCurrencies(existing, filed),
    };
    const dest = await this.settleDest(merged, filed, patch.destAmount, stored, date, now);

    const patchedTagIds = patch.tagIds !== undefined ? await this.assertTagsValid(groupId, patch.tagIds) : undefined;

    // Every field below is fully resolved (existing value or patch override), never `undefined`
    // — passing `undefined` into a TypeORM partial update is unreliable to reason about, so the
    // safe rule here is: always write a concrete value.
    await this.transactions.update(
      { id: transactionId, groupId },
      {
        type: merged.type,
        date,
        amount: merged.amount,
        // Its account's, as on create - which also puts right a row recorded in another currency.
        currencyId: filed.currencyId,
        accountId: merged.accountId,
        categoryId: filed.categoryId,
        subcategoryId: filed.subcategoryId,
        toAccountId: merged.toAccountId,
        destAmount: dest.destAmount,
        destAmountAsOf: dest.destAmountAsOf,
        percentage: merged.percentage,
        percentageBase: merged.percentageBase,
        roundBalanceTo: merged.roundBalanceTo,
        percentageAsOf: asOf,
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
      await materializeOccurrences(this.rules.manager, rule, new Date(), this.rates.lookup);
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
    // After the amounts: a received amount converted at a rate follows what's sent, too.
    const reconverted = await reworkRateEstimates(this.transactions.manager, this.rates.lookup, ids, now);

    const actions = new Map(reworked.map(({ id, action }) => [id, action]));
    const groups = new Map(reworked.map(({ id, groupId }) => [id, groupId]));
    for (const { id, groupId } of reconverted) {
      if (!actions.has(id)) {
        actions.set(id, 'updated');
        groups.set(id, groupId);
      }
    }
    for (const [id, action] of actions) {
      if (id !== own) {
        const groupId = groups.get(id) as string;
        this.realtime.emitToGroup(groupId, { resourceType: 'Transaction', resourceId: id, action, groupId });
      }
    }
    return actions;
  }

  /**
   * The received amount a transfer is stored with, and when it was last converted at a rate (see
   * planDestAmount). Anything but a transfer between two currencies keeps what it was given, as it
   * always has.
   */
  private async settleDest(
    merged: { type: TransactionType; amount: string; destAmount: string | null },
    validated: Validated,
    requested: string | null | undefined,
    stored: StoredDest | null,
    date: Date,
    now: Date,
  ): Promise<{ destAmount: string | null; destAmountAsOf: Date | null }> {
    const { currencyId, toCurrencyId } = validated;
    if (merged.type !== TransactionType.TRANSFER || toCurrencyId === null || toCurrencyId === currencyId) {
      return { destAmount: merged.destAmount, destAmountAsOf: null };
    }

    const plan = planDestAmount(requested, stored, date);
    if (plan.kind === 'typed') {
      return { destAmount: plan.destAmount, destAmountAsOf: null };
    }
    if (plan.kind === 'keep' && stored) {
      return { destAmount: stored.destAmount, destAmountAsOf: stored.destAmountAsOf };
    }

    const [from, to] = await this.codesOf(currencyId, toCurrencyId);
    const rate = await this.rates.rateBetween(from, to);
    if (rate === null) {
      throw new BadRequestException(
        `There's no exchange rate from ${from} to ${to} right now: send destAmount, the amount that arrived`,
      );
    }
    return { destAmount: convertedDest(merged.amount, rate), destAmountAsOf: now };
  }

  /**
   * Whether an edited transfer still goes between the same two currencies. Read off the accounts'
   * currencies as they are now, the ones balances read amounts in: an account's currency can itself
   * be changed, so the currency recorded on the row isn't to be trusted for this.
   */
  private async sameCurrencies(existing: Transaction, validated: Validated): Promise<boolean> {
    if (!existing.toAccountId) {
      return false;
    }
    const before = await this.accounts.findBy({ id: In([existing.accountId, existing.toAccountId]) });
    const currencyOf = (id: string) => before.find((account) => account.id === id)?.currencyId;
    return currencyOf(existing.accountId) === validated.currencyId && currencyOf(existing.toAccountId) === validated.toCurrencyId;
  }

  private async codesOf(...ids: number[]): Promise<string[]> {
    const found = await this.currencies.findBy({ id: In(ids) });
    return ids.map((id) => found.find((currency) => currency.id === id)?.code ?? '');
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

  private async authorize(userId: string, groupId: string, action: Action, subject: Subject): Promise<GroupAuthzContext> {
    const ctx = await this.abilities.forGroup(userId, groupId);
    assertCan(ctx.ability, action, subject);
    return ctx;
  }
}

function assertCan(ability: AppAbility, action: Action, subject: Subject): void {
  if (!ability.can(action, subject)) {
    throw new ForbiddenException(`Not allowed to ${action} ${subject}`);
  }
}
