import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Group, GroupMember } from '@ft/api-database';
import { defineAbilityFor, type AppAbility, type MemberRole } from '@ft/shared-contracts';

export interface GroupAuthzContext {
  groupId: string;
  // The group is loaded here anyway, to check the caller belongs to it; callers that need to name
  // it — a notification's title, say — take it from here rather than reading the row again.
  groupName: string;
  role: MemberRole;
  archived: boolean;
  ability: AppAbility;
}

/**
 * Loads a caller's standing in one group and turns it into a CASL ability.
 *
 * Not a guard, deliberately. Guards run before interceptors, so a guard would execute outside
 * the transaction that RlsContextInterceptor opens — with no app.current_user_id set, RLS would
 * hide every row from it and membership would always look absent.
 */
@Injectable()
export class AbilityFactory {
  constructor(
    @InjectRepository(GroupMember) private readonly members: Repository<GroupMember>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
  ) {}

  async forGroup(userId: string, groupId: string): Promise<GroupAuthzContext> {
    // Filtering on userId matters even under RLS: the select policy exposes every member of a
    // group you belong to, so omitting it could return a co-member's row — and their role.
    const membership = await this.members.findOneBy({ groupId, userId });
    const group = membership ? await this.groups.findOneBy({ id: groupId }) : null;

    if (!membership || !group) {
      // 404 rather than 403 on purpose: a 403 would confirm the group exists to someone who
      // has no business knowing that.
      throw new NotFoundException('Group not found');
    }

    const archived = group.archivedAt !== null;
    return {
      groupId,
      groupName: group.name,
      role: membership.role,
      archived,
      ability: defineAbilityFor({ role: membership.role, archived }),
    };
  }
}
