import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { GroupMember, MemberRole, User } from '@ft/api-database';
import type { AssignableMemberRole } from '@ft/shared-contracts';
import { AbilityFactory, type GroupAuthzContext } from '../_core/authz/ability.factory';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';

export interface MemberWithEmail {
  userId: string;
  email: string;
  role: MemberRole;
  joinedAt: Date;
}

@Injectable()
export class MembersService {
  constructor(
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly abilities: AbilityFactory,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  async list(userId: string, groupId: string): Promise<MemberWithEmail[]> {
    await this.abilities.forGroup(userId, groupId);
    const rows = await this.members.find({ where: { groupId }, relations: { user: true } });
    return rows.map(toDto);
  }

  // Named "Existing" because there's no invite-before-registration flow: the invitee has to
  // already have an account, or this 404s. If that changes, this method still only covers the
  // existing-user path — a new one would handle the other.
  @Transactional()
  async inviteExisting(
    userId: string,
    groupId: string,
    email: string,
    role: AssignableMemberRole,
  ): Promise<MemberWithEmail> {
    const ctx = await this.authorizeManage(userId, groupId);
    const invitee = await this.users.findOneBy({ email });
    if (!invitee) {
      throw new NotFoundException('No user with that email');
    }
    const existing = await this.members.findOneBy({ groupId: ctx.groupId, userId: invitee.id });
    if (existing) {
      throw new ConflictException('Already a member of this group');
    }
    const created = await this.members.save(
      this.members.create({ groupId: ctx.groupId, userId: invitee.id, role: role as MemberRole }),
    );
    this.realtime.joinUserToGroup(invitee.id, ctx.groupId);
    this.realtime.emitToGroup(ctx.groupId, {
      resourceType: 'GroupMember',
      resourceId: invitee.id,
      action: 'created',
      groupId: ctx.groupId,
    });
    return toDto({ ...created, user: invitee });
  }

  @Transactional()
  async updateRole(
    userId: string,
    groupId: string,
    targetUserId: string,
    role: AssignableMemberRole,
  ): Promise<MemberWithEmail> {
    const ctx = await this.authorizeManage(userId, groupId);
    const target = await this.members.findOne({
      where: { groupId: ctx.groupId, userId: targetUserId },
      relations: { user: true },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === MemberRole.OWNER) {
      // Ownership moves Group.ownerId in lockstep (see the comment on that column) — that's a
      // dedicated transferOwnership flow, not implemented yet, and not this endpoint's job.
      throw new ConflictException("Can't change the owner's role here");
    }

    await this.members.update({ groupId: ctx.groupId, userId: targetUserId }, { role: role as MemberRole });
    target.role = role as MemberRole;
    this.realtime.emitToGroup(ctx.groupId, {
      resourceType: 'GroupMember',
      resourceId: targetUserId,
      action: 'updated',
      groupId: ctx.groupId,
    });
    return toDto(target);
  }

  @Transactional()
  async remove(userId: string, groupId: string, targetUserId: string): Promise<MemberWithEmail> {
    // Not authorizeManage(): removing yourself is always allowed, regardless of role.
    const ctx = await this.abilities.forGroup(userId, groupId);
    const isSelf = targetUserId === userId;
    if (!isSelf && !ctx.ability.can('manage', 'GroupMember')) {
      throw new ForbiddenException('Not allowed to remove this member');
    }

    const target = await this.members.findOne({
      where: { groupId: ctx.groupId, userId: targetUserId },
      relations: { user: true },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === MemberRole.OWNER) {
      const ownerCount = await this.members.count({ where: { groupId: ctx.groupId, role: MemberRole.OWNER } });
      if (ownerCount <= 1) {
        throw new ConflictException("The group's last owner can't be removed");
      }
    }

    await this.members.delete({ groupId: ctx.groupId, userId: targetUserId });
    this.realtime.removeUserFromGroup(targetUserId, ctx.groupId);
    this.realtime.emitToGroup(ctx.groupId, {
      resourceType: 'GroupMember',
      resourceId: targetUserId,
      action: 'deleted',
      groupId: ctx.groupId,
    });
    return toDto(target);
  }

  private async authorizeManage(userId: string, groupId: string): Promise<GroupAuthzContext> {
    const ctx = await this.abilities.forGroup(userId, groupId);
    if (!ctx.ability.can('manage', 'GroupMember')) {
      throw new ForbiddenException('Not allowed to manage members');
    }
    return ctx;
  }
}

function toDto(member: { userId: string; role: MemberRole; joinedAt: Date; user: { email: string } }): MemberWithEmail {
  return { userId: member.userId, email: member.user.email, role: member.role, joinedAt: member.joinedAt };
}
