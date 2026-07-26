import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Group, GroupMember, MemberRole } from '@ft/api-database';
import type { Action, AppAbility, MemberRole as WireRole, Subject } from '@ft/shared-contracts';
import { AbilityFactory, type GroupAuthzContext } from '../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { OnboardingService, type SeedResult } from '../onboarding/onboarding.service';

export interface GroupWithRole {
  group: Group;
  // The shared string union, not api-database's TypeORM enum: a string enum member is
  // assignable to its literal type but not the reverse, so typing the boundary with the wire
  // type lets both the entity's enum and the ability context flow in without a cast. If the
  // two lists ever drift, the contract's z.enum + validateResponses catches it.
  role: WireRole;
}

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    private readonly abilities: AbilityFactory,
    private readonly onboarding: OnboardingService,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  async list(userId: string): Promise<GroupWithRole[]> {
    const memberships = await this.members.find({ where: { userId }, relations: { group: true } });
    return memberships.map((membership) => ({ group: membership.group, role: membership.role }));
  }

  @Transactional()
  async create(userId: string, name: string): Promise<GroupWithRole> {
    // No ability check here: creating a group needs no permission within a group that doesn't
    // exist yet. The RLS insert policy still pins owner_id to the caller.
    const group = await this.groups.save(this.groups.create({ name, ownerId: userId }));
    await this.members.save(this.members.create({ groupId: group.id, userId, role: MemberRole.OWNER }));
    return { group, role: MemberRole.OWNER };
  }

  @Transactional()
  async rename(userId: string, groupId: string, name: string): Promise<GroupWithRole> {
    const ctx = await this.authorize(userId, groupId, 'update', 'Group');
    await this.groups.update(groupId, { name });
    this.realtime.emitToGroup(groupId, { resourceType: 'Group', resourceId: groupId, action: 'updated', groupId });
    return this.reload(ctx);
  }

  @Transactional()
  async archive(userId: string, groupId: string): Promise<GroupWithRole> {
    const ctx = await this.authorize(userId, groupId, 'archive', 'Group');
    await this.groups.update(groupId, { archivedAt: new Date() });
    this.realtime.emitToGroup(groupId, { resourceType: 'Group', resourceId: groupId, action: 'archived', groupId });
    return this.reload(ctx);
  }

  @Transactional()
  async restore(userId: string, groupId: string): Promise<GroupWithRole> {
    const ctx = await this.authorize(userId, groupId, 'restore', 'Group');
    await this.groups.update(groupId, { archivedAt: null });
    this.realtime.emitToGroup(groupId, { resourceType: 'Group', resourceId: groupId, action: 'restored', groupId });
    return this.reload(ctx);
  }

  @Transactional()
  async seed(userId: string, groupId: string, language?: string): Promise<SeedResult> {
    // 'create' + 'Account' is the same CASL check any ledger write goes through: a viewer
    // can't seed a group any more than they could create an account by hand, and an archived
    // group can't be seeded at all.
    const ctx = await this.authorize(userId, groupId, 'create', 'Account');
    return this.onboarding.seedGroup(ctx.groupId, userId, language);
  }

  private async authorize(
    userId: string,
    groupId: string,
    action: Action,
    subject: Subject,
  ): Promise<GroupAuthzContext> {
    const ctx = await this.abilities.forGroup(userId, groupId);
    assertCan(ctx.ability, action, subject);
    return ctx;
  }

  private async reload(ctx: GroupAuthzContext): Promise<GroupWithRole> {
    const group = await this.groups.findOneByOrFail({ id: ctx.groupId });
    return { group, role: ctx.role };
  }
}

function assertCan(ability: AppAbility, action: Action, subject: Subject): void {
  if (!ability.can(action, subject)) {
    // Reaching here means membership exists (AbilityFactory already 404'd otherwise), so
    // admitting the group exists gives nothing away — 403 is the honest answer.
    throw new ForbiddenException(`Not allowed to ${action} ${subject}`);
  }
}
