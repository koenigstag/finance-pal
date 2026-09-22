import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Category, CategoryRule } from '@ft/api-database';
import type { Action } from '@ft/shared-contracts';
import { AbilityFactory } from '../../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';

export interface CategoryRuleInput {
  pattern: string;
  categoryId: string;
}

/**
 * A group's category rules, which file what bank notifications record. They follow the ledger's
 * own rule, as the RLS policies on the table do too: anyone in the group sees them, and anyone who
 * may record money in it may add, change and delete them.
 */
@Injectable()
export class CategoryRulesService {
  constructor(
    @InjectRepository(CategoryRule) private readonly rules: Repository<CategoryRule>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    private readonly abilities: AbilityFactory,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  // Alphabetically by the text, as a person looks for one.
  async list(userId: string, groupId: string): Promise<CategoryRule[]> {
    await this.authorize(userId, groupId, 'read');
    const rules = await this.rules.find({ where: { groupId } });
    return rules.sort((a, b) => a.pattern.localeCompare(b.pattern, undefined, { sensitivity: 'base' }));
  }

  @Transactional()
  async create(userId: string, groupId: string, input: CategoryRuleInput): Promise<CategoryRule> {
    await this.authorize(userId, groupId, 'create');
    await this.assertUsableCategory(groupId, input.categoryId);
    await this.assertPatternFree(groupId, input.pattern);
    const saved = await this.rules.save(
      this.rules.create({ groupId, pattern: input.pattern, categoryId: input.categoryId, createdBy: userId }),
    );
    this.realtime.emitToGroup(groupId, { resourceType: 'CategoryRule', resourceId: saved.id, action: 'created', groupId });
    return saved;
  }

  @Transactional()
  async update(userId: string, groupId: string, ruleId: string, patch: Partial<CategoryRuleInput>): Promise<CategoryRule> {
    await this.authorize(userId, groupId, 'update');
    await this.findOrFail(groupId, ruleId);
    if (patch.categoryId !== undefined) {
      await this.assertUsableCategory(groupId, patch.categoryId);
    }
    if (patch.pattern !== undefined) {
      await this.assertPatternFree(groupId, patch.pattern, ruleId);
    }
    // Only what the request names: a key present with undefined in a TypeORM update is best avoided.
    const changes: Partial<CategoryRuleInput> = {};
    if (patch.pattern !== undefined) {
      changes.pattern = patch.pattern;
    }
    if (patch.categoryId !== undefined) {
      changes.categoryId = patch.categoryId;
    }
    if (Object.keys(changes).length > 0) {
      await this.rules.update({ id: ruleId, groupId }, changes);
    }
    const updated = await this.findOrFail(groupId, ruleId);
    this.realtime.emitToGroup(groupId, { resourceType: 'CategoryRule', resourceId: ruleId, action: 'updated', groupId });
    return updated;
  }

  // What the rule filed stays where it is: it only decides for what comes next.
  @Transactional()
  async remove(userId: string, groupId: string, ruleId: string): Promise<CategoryRule> {
    await this.authorize(userId, groupId, 'delete');
    const rule = await this.findOrFail(groupId, ruleId);
    await this.rules.delete({ id: ruleId, groupId });
    this.realtime.emitToGroup(groupId, { resourceType: 'CategoryRule', resourceId: ruleId, action: 'deleted', groupId });
    return rule;
  }

  // A category of the group, and one in use: an archived category is left out of filing anyway,
  // so a rule for one would silently do nothing.
  private async assertUsableCategory(groupId: string, categoryId: string): Promise<void> {
    const category = await this.categories.findOneBy({ id: categoryId, groupId });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    if (category.archived) {
      throw new BadRequestException(`"${category.name}" is archived`);
    }
  }

  // One rule per text, whatever its case: a second one could only ever lose to the first. The
  // table's unique index says the same, as the last word.
  private async assertPatternFree(groupId: string, pattern: string, exceptRuleId?: string): Promise<void> {
    const wanted = pattern.toLowerCase();
    const rules = await this.rules.find({ select: { id: true, pattern: true }, where: { groupId } });
    if (rules.some((rule) => rule.id !== exceptRuleId && rule.pattern.toLowerCase() === wanted)) {
      throw new BadRequestException(`There's already a rule for "${pattern}"`);
    }
  }

  private async findOrFail(groupId: string, ruleId: string): Promise<CategoryRule> {
    const rule = await this.rules.findOneBy({ id: ruleId, groupId });
    if (!rule) {
      throw new NotFoundException('Category rule not found');
    }
    return rule;
  }

  private async authorize(userId: string, groupId: string, action: Action): Promise<void> {
    // Also the 404 for a group the caller isn't in, like every other group-scoped route.
    const { ability } = await this.abilities.forGroup(userId, groupId);
    if (!ability.can(action, 'CategoryRule')) {
      throw new ForbiddenException(`Not allowed to ${action} a category rule`);
    }
  }
}
