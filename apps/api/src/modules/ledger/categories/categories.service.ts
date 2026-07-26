import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Category, CategoryType } from '@ft/api-database';
import { CATEGORY_TYPES, type Action, type AppAbility, type Subject } from '@ft/shared-contracts';
import { AbilityFactory } from '../../_core/authz/ability.factory';

// The shared string union, not api-database's TypeORM enum — see the identical comment on
// GroupWithRole.role in GroupsService for why (assignable one way, not the other).
export interface CreateCategoryInput {
  parentId?: string | null;
  type: (typeof CATEGORY_TYPES)[number];
  name: string;
  icon?: string;
  color?: string;
  sortOrder?: number;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    private readonly abilities: AbilityFactory,
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
      await this.findOrFail(groupId, input.parentId);
    }
    const category = this.categories.create({
      ...input,
      type: input.type as CategoryType,
      parentId: input.parentId ?? null,
      groupId,
      createdBy: userId,
    });
    return this.categories.save(category);
  }

  @Transactional()
  async update(userId: string, groupId: string, categoryId: string, patch: UpdateCategoryInput): Promise<Category> {
    await this.authorize(userId, groupId, 'update', 'Category');
    await this.findOrFail(groupId, categoryId);

    if (patch.parentId !== undefined && patch.parentId !== null) {
      if (patch.parentId === categoryId) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      await this.findOrFail(groupId, patch.parentId);
      await this.assertNoCycle(groupId, categoryId, patch.parentId);
    }

    await this.categories.update(
      { id: categoryId, groupId },
      { ...patch, type: patch.type as CategoryType | undefined },
    );
    return this.findOrFail(groupId, categoryId);
  }

  @Transactional()
  async archive(userId: string, groupId: string, categoryId: string): Promise<Category> {
    await this.authorize(userId, groupId, 'update', 'Category');
    await this.findOrFail(groupId, categoryId);
    await this.categories.update({ id: categoryId, groupId }, { archived: true, archivedAt: new Date() });
    return this.findOrFail(groupId, categoryId);
  }

  @Transactional()
  async restore(userId: string, groupId: string, categoryId: string): Promise<Category> {
    await this.authorize(userId, groupId, 'update', 'Category');
    await this.findOrFail(groupId, categoryId);
    await this.categories.update({ id: categoryId, groupId }, { archived: false, archivedAt: null });
    return this.findOrFail(groupId, categoryId);
  }

  @Transactional()
  async remove(userId: string, groupId: string, categoryId: string): Promise<Category> {
    await this.authorize(userId, groupId, 'delete', 'Category');
    const category = await this.findOrFail(groupId, categoryId);
    await this.categories.softDelete({ id: categoryId, groupId });
    return category;
  }

  // Walks the proposed parent's ancestor chain up to the root, rejecting if it passes through
  // the category being moved — that would turn the tree into a cycle. Trees are shallow and
  // scoped to one group, so this is cheap even without a depth cap.
  private async assertNoCycle(groupId: string, categoryId: string, proposedParentId: string): Promise<void> {
    let currentId: string | null = proposedParentId;
    while (currentId) {
      if (currentId === categoryId) {
        throw new BadRequestException('This would make the category its own ancestor');
      }
      const current: Category | null = await this.categories.findOneBy({ id: currentId, groupId });
      currentId = current?.parentId ?? null;
    }
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
