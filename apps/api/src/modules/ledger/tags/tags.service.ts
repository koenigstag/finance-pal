import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Tag } from '@ft/api-database';
import type { Action, AppAbility, Subject } from '@ft/shared-contracts';
import { AbilityFactory } from '../../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    private readonly abilities: AbilityFactory,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  async list(userId: string, groupId: string): Promise<Tag[]> {
    await this.authorize(userId, groupId, 'read', 'Tag');
    return this.tags.find({ where: { groupId }, order: { name: 'ASC' } });
  }

  @Transactional()
  async create(userId: string, groupId: string, name: string): Promise<Tag> {
    await this.authorize(userId, groupId, 'create', 'Tag');
    await this.assertNameFree(groupId, name);
    const saved = await this.tags.save(this.tags.create({ groupId, name }));
    this.realtime.emitToGroup(groupId, { resourceType: 'Tag', resourceId: saved.id, action: 'created', groupId });
    return saved;
  }

  @Transactional()
  async rename(userId: string, groupId: string, tagId: string, name: string): Promise<Tag> {
    await this.authorize(userId, groupId, 'update', 'Tag');
    await this.findOrFail(groupId, tagId);
    await this.assertNameFree(groupId, name, tagId);
    await this.tags.update({ id: tagId, groupId }, { name });
    const updated = await this.findOrFail(groupId, tagId);
    this.realtime.emitToGroup(groupId, { resourceType: 'Tag', resourceId: tagId, action: 'updated', groupId });
    return updated;
  }

  @Transactional()
  async remove(userId: string, groupId: string, tagId: string): Promise<Tag> {
    await this.authorize(userId, groupId, 'delete', 'Tag');
    const tag = await this.findOrFail(groupId, tagId);
    await this.tags.delete({ id: tagId, groupId });
    this.realtime.emitToGroup(groupId, { resourceType: 'Tag', resourceId: tagId, action: 'deleted', groupId });
    return tag;
  }

  private async assertNameFree(groupId: string, name: string, excludeTagId?: string): Promise<void> {
    const existing = await this.tags.findOneBy({ groupId, name });
    if (existing && existing.id !== excludeTagId) {
      throw new ConflictException('A tag with this name already exists in the group');
    }
  }

  private async findOrFail(groupId: string, tagId: string): Promise<Tag> {
    const tag = await this.tags.findOneBy({ id: tagId, groupId });
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return tag;
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
