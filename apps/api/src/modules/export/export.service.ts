import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccountTarget, Category, Currency, RecurringRule, Tag, Transaction, TransactionTag } from '@ft/api-database';
import { AbilityFactory } from '../_core/authz/ability.factory';
import { exportTables, type GroupSnapshot, type SnapshotCategory } from '../data-file/export-tables';
import { writeDataFile, type DataFile, type FileFormat } from '../data-file/files';
import type { TableName } from '../data-file/tables';
import { AccountsService } from '../ledger/accounts/accounts.service';
import { nextOccurrence, plannedOccurrenceDates } from '../recurring/occurrence-materializer';

export interface ExportRequest {
  format: FileFormat;
  // With csv, just this table as a CSV file on its own; see WriteRequest.
  table?: TableName;
  // Dates in the file are local times in this zone.
  timezone: string;
}

// How the app lists categories: expenses first, as its picker does.
const CATEGORY_TYPE_ORDER = ['expense', 'income'];

@Injectable()
export class ExportService {
  constructor(
    @InjectRepository(Currency) private readonly currencies: Repository<Currency>,
    @InjectRepository(AccountTarget) private readonly targets: Repository<AccountTarget>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(TransactionTag) private readonly transactionTags: Repository<TransactionTag>,
    @InjectRepository(RecurringRule) private readonly rules: Repository<RecurringRule>,
    private readonly abilities: AbilityFactory,
    private readonly accounts: AccountsService,
  ) {}

  /** A group's data as a Finance Pal file, for any member: everyone in a group may read all of it. */
  async exportGroup(userId: string, groupId: string, request: ExportRequest, now = new Date()): Promise<DataFile> {
    const { groupName } = await this.abilities.forGroup(userId, groupId);
    const snapshot = await this.snapshot(userId, groupId, now);
    const tables = exportTables(snapshot, { timezone: request.timezone, now });
    return writeDataFile(tables, { ...request, groupName, now });
  }

  private async snapshot(userId: string, groupId: string, now: Date): Promise<GroupSnapshot> {
    const codes = new Map((await this.currencies.find()).map((currency) => [currency.id, currency.code]));
    // Through the accounts service, for balances as the app shows them: planned transactions aside.
    const accounts = await this.accounts.list(userId, groupId, true);
    const targets = new Map(
      (await this.targets.findBy({ accountId: In(accounts.map(({ account }) => account.id)) })).map((target) => [target.accountId, target]),
    );

    const tagNames = new Map((await this.tags.findBy({ groupId })).map((tag) => [tag.id, tag.name]));
    const tagsOf = new Map<string, string[]>();
    const links = await this.transactionTags
      .createQueryBuilder('tt')
      .innerJoin('tt.transaction', 't')
      .where('t.group_id = :groupId', { groupId })
      .getMany();
    for (const { transactionId, tagId } of links) {
      const name = tagNames.get(tagId);
      if (name !== undefined) {
        tagsOf.set(transactionId, [...(tagsOf.get(transactionId) ?? []), name]);
      }
    }

    const transactions = await this.transactions.find({ where: { groupId }, order: { date: 'ASC', createdAt: 'ASC' } });
    const rules = await this.rules.find({ where: { groupId }, order: { createdAt: 'ASC' } });
    const planned = await plannedOccurrenceDates(
      this.rules.manager,
      rules.map((rule) => rule.id),
      now,
    );

    return {
      accounts: accounts.map(({ account, balance }) => ({
        id: account.id,
        name: account.name,
        currency: codes.get(account.currencyId) ?? String(account.currencyId),
        type: account.type,
        balance,
        isIncludedInBalance: account.isIncludedInBalance,
        isFavourite: account.isFavourite,
        archived: account.archived,
        description: account.description,
        icon: account.icon,
        color: account.color,
        limitAmount: targets.get(account.id)?.limitAmount ?? null,
        goalAmount: targets.get(account.id)?.goalAmount ?? null,
      })),
      categories: await this.categoriesInOrder(groupId),
      transactions: transactions.map((transaction) => ({
        type: transaction.type,
        date: transaction.date,
        amount: transaction.amount,
        accountId: transaction.accountId,
        categoryId: transaction.categoryId,
        subcategoryId: transaction.subcategoryId,
        toAccountId: transaction.toAccountId,
        destAmount: transaction.destAmount,
        destAmountAsOf: transaction.destAmountAsOf,
        note: transaction.note,
        percentage: transaction.percentage,
        percentageBase: transaction.percentageBase,
        roundBalanceTo: transaction.roundBalanceTo,
        tags: tagsOf.get(transaction.id) ?? [],
        recurringRuleId: transaction.recurringRuleId,
        recurrenceDate: transaction.recurrenceDate,
      })),
      series: rules.map((rule) => ({
        id: rule.id,
        type: rule.type,
        amount: rule.amount,
        accountId: rule.accountId,
        categoryId: rule.categoryId,
        subcategoryId: rule.subcategoryId,
        toAccountId: rule.toAccountId,
        note: rule.note,
        percentage: rule.percentage,
        percentageBase: rule.percentageBase,
        roundBalanceTo: rule.roundBalanceTo,
        intervalUnit: rule.intervalUnit,
        intervalValue: rule.intervalValue,
        startsAt: rule.startsAt,
        nextOccurrence: nextOccurrence(rule, planned.get(rule.id), now),
        timezone: rule.timezone,
        active: rule.active,
        reminderDaysBefore: rule.reminderDaysBefore,
      })),
    };
  }

  // Each type's categories in their order, every one followed by its own subcategories.
  private async categoriesInOrder(groupId: string): Promise<SnapshotCategory[]> {
    const all = await this.categories.find({ where: { groupId }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
    const plain = (category: Category): SnapshotCategory => ({
      id: category.id,
      parentId: category.parentId,
      type: category.type,
      name: category.name,
      icon: category.icon,
      color: category.color,
      archived: category.archived,
    });
    const ordered: SnapshotCategory[] = [];
    for (const type of CATEGORY_TYPE_ORDER) {
      for (const parent of all.filter((category) => category.type === type && category.parentId === null)) {
        ordered.push(plain(parent), ...all.filter((category) => category.parentId === parent.id).map(plain));
      }
    }
    return ordered;
  }
}
