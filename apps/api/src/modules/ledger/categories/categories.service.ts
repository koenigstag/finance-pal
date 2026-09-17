import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Category, CategoryType, RecurringRule, Transaction } from '@ft/api-database';
import { CATEGORY_TYPES, type Action, type AppAbility, type Subject } from '@ft/shared-contracts';
import { AbilityFactory } from '../../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';

// The shared string union, not api-database's TypeORM enum — see the identical comment on
// GroupWithRole.role in GroupsService for why (assignable one way, not the other).
export interface CreateCategoryInput {
  parentId?: string | null;
  type: (typeof CATEGORY_TYPES)[number];
  name: string;
  icon?: string | null;
  color?: string | null;
  sortOrder?: number;
}

// No type: it's fixed after creation (see the update contract).
export type UpdateCategoryInput = Partial<Omit<CreateCategoryInput, 'type'>>;

export interface CategoryUsage {
  subcategoryCount: number;
  transactionCount: number;
  plannedTransactionCount: number;
  recurringRuleCount: number;
}

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    @InjectRepository(RecurringRule) private readonly recurringRules: Repository<RecurringRule>,
    private readonly abilities: AbilityFactory,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  async list(userId: string, groupId: string, includeArchived: boolean): Promise<Category[]> {
    await this.authorize(userId, groupId, 'read', 'Category');
    return this.categories.find({
      where: includeArchived ? { groupId } : { groupId, archived: false },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async get(userId: string, groupId: string, categoryId: string): Promise<Category> {
    await this.authorize(userId, groupId, 'read', 'Category');
    return this.findOrFail(groupId, categoryId);
  }

  @Transactional()
  async create(userId: string, groupId: string, input: CreateCategoryInput): Promise<Category> {
    await this.authorize(userId, groupId, 'create', 'Category');
    if (input.parentId) {
      await this.assertValidParent(groupId, input.parentId, input.type);
    }
    const category = this.categories.create({
      ...input,
      type: input.type as CategoryType,
      parentId: input.parentId ?? null,
      groupId,
      createdBy: userId,
    });
    const saved = await this.categories.save(category);
    this.realtime.emitToGroup(groupId, { resourceType: 'Category', resourceId: saved.id, action: 'created', groupId });
    return saved;
  }

  @Transactional()
  async update(userId: string, groupId: string, categoryId: string, patch: UpdateCategoryInput): Promise<Category> {
    await this.authorize(userId, groupId, 'update', 'Category');
    const category = await this.findOrFail(groupId, categoryId);

    if (patch.parentId !== undefined && patch.parentId !== null && patch.parentId !== category.parentId) {
      if (patch.parentId === categoryId) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      await this.assertValidParent(groupId, patch.parentId, category.type);
      // Moving a category that has subcategories under another would make a third level.
      if (await this.categories.exists({ where: { groupId, parentId: categoryId } })) {
        throw new BadRequestException('A category with subcategories cannot become a subcategory');
      }
    }

    await this.categories.update({ id: categoryId, groupId }, patch);
    const updated = await this.findOrFail(groupId, categoryId);
    this.realtime.emitToGroup(groupId, { resourceType: 'Category', resourceId: categoryId, action: 'updated', groupId });
    return updated;
  }

  @Transactional()
  async archive(userId: string, groupId: string, categoryId: string): Promise<Category> {
    await this.authorize(userId, groupId, 'update', 'Category');
    await this.findOrFail(groupId, categoryId);
    await this.categories.update({ id: categoryId, groupId }, { archived: true, archivedAt: new Date() });
    const category = await this.findOrFail(groupId, categoryId);
    this.realtime.emitToGroup(groupId, { resourceType: 'Category', resourceId: categoryId, action: 'archived', groupId });
    return category;
  }

  @Transactional()
  async restore(userId: string, groupId: string, categoryId: string): Promise<Category> {
    await this.authorize(userId, groupId, 'update', 'Category');
    await this.findOrFail(groupId, categoryId);
    await this.categories.update({ id: categoryId, groupId }, { archived: false, archivedAt: null });
    const category = await this.findOrFail(groupId, categoryId);
    this.realtime.emitToGroup(groupId, { resourceType: 'Category', resourceId: categoryId, action: 'restored', groupId });
    return category;
  }

  async usage(userId: string, groupId: string, categoryId: string): Promise<CategoryUsage> {
    await this.authorize(userId, groupId, 'read', 'Category');
    await this.findOrFail(groupId, categoryId);
    const subcategoryIds = await this.subcategoryIds(groupId, categoryId);
    const ids = [categoryId, ...subcategoryIds];

    // One after another: the request's RLS transaction holds a single connection.
    const now = new Date();
    const transactionCount = await this.transactionsIn(groupId, ids).andWhere('date <= :now', { now }).getCount();
    const plannedTransactionCount = await this.transactionsIn(groupId, ids).andWhere('date > :now', { now }).getCount();
    const recurringRuleCount = await this.recurringRules.count({ where: { groupId, categoryId: In(ids) } });
    return { subcategoryCount: subcategoryIds.length, transactionCount, plannedTransactionCount, recurringRuleCount };
  }

  /**
   * Deletes the category and its subcategories. What was filed under them keeps its money and
   * history: transactions and recurring rules only lose the category. Leaving them pointing at a
   * deleted row would break them instead — the transaction validator rejects a deleted category,
   * so they couldn't even be edited any more.
   */
  @Transactional()
  async remove(userId: string, groupId: string, categoryId: string): Promise<Category> {
    await this.authorize(userId, groupId, 'delete', 'Category');
    const category = await this.findOrFail(groupId, categoryId);
    const ids = [categoryId, ...(await this.subcategoryIds(groupId, categoryId))];

    // Plain column updates: a category isn't part of an account balance, and an occurrence whose
    // rule loses the same category stays in step with it, so nothing here counts as customizing.
    await this.transactions.update({ groupId, categoryId: In(ids), deletedAt: IsNull() }, { categoryId: null });
    await this.recurringRules.update({ groupId, categoryId: In(ids) }, { categoryId: null });
    await this.categories.softDelete({ groupId, id: In(ids) });
    this.realtime.emitToGroup(groupId, { resourceType: 'Category', resourceId: categoryId, action: 'deleted', groupId });
    return category;
  }

  // Categories are two levels deep: a parent must be a top-level category of the same type. That
  // also rules out cycles — together with update() refusing to nest a category that has
  // subcategories of its own — without walking ancestor chains.
  private async assertValidParent(groupId: string, parentId: string, type: CategoryType | `${CategoryType}`): Promise<void> {
    const parent = await this.findOrFail(groupId, parentId);
    if (parent.type !== type) {
      throw new BadRequestException('A subcategory must have the same type as its parent');
    }
    if (parent.parentId !== null) {
      throw new BadRequestException('A subcategory cannot have subcategories of its own');
    }
  }

  private async subcategoryIds(groupId: string, categoryId: string): Promise<string[]> {
    const children = await this.categories.find({ select: { id: true }, where: { groupId, parentId: categoryId } });
    return children.map((child) => child.id);
  }

  private transactionsIn(groupId: string, categoryIds: string[]) {
    return this.transactions
      .createQueryBuilder('transaction')
      .where('transaction.group_id = :groupId', { groupId })
      .andWhere('transaction.category_id IN (:...categoryIds)', { categoryIds });
  }

  private async findOrFail(groupId: string, categoryId: string): Promise<Category> {
    const category = await this.categories.findOneBy({ id: categoryId, groupId });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    return category;
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
