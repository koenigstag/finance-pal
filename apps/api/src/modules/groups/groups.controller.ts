import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { groupsContract } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { GroupsService, type GroupWithRole } from './groups.service';
import { MembersService, type MemberWithEmail } from './members.service';

function toGroupDto({ group, role }: GroupWithRole) {
  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    archivedAt: group.archivedAt?.toISOString() ?? null,
    role,
  };
}

function toMemberDto(member: MemberWithEmail) {
  return {
    userId: member.userId,
    email: member.email,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}

@Controller()
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly members: MembersService,
  ) {}

  @TsRestHandler(groupsContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.list, async () => {
      const groups = await this.groups.list(requireUser(user).id);
      return { status: 200 as const, body: groups.map(toGroupDto) };
    });
  }

  @TsRestHandler(groupsContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.create, async ({ body }) => {
      const created = await this.groups.create(requireUser(user).id, body.name);
      return { status: 201 as const, body: toGroupDto(created) };
    });
  }

  @TsRestHandler(groupsContract.rename)
  rename(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.rename, async ({ params, body }) => {
      const updated = await this.groups.rename(requireUser(user).id, params.groupId, body.name);
      return { status: 200 as const, body: toGroupDto(updated) };
    });
  }

  @TsRestHandler(groupsContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.remove, async ({ params }) => {
      await this.groups.remove(requireUser(user).id, params.groupId);
      return { status: 200 as const, body: { id: params.groupId } };
    });
  }

  @TsRestHandler(groupsContract.archive)
  archive(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.archive, async ({ params }) => {
      const updated = await this.groups.archive(requireUser(user).id, params.groupId);
      return { status: 200 as const, body: toGroupDto(updated) };
    });
  }

  @TsRestHandler(groupsContract.restore)
  restore(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.restore, async ({ params }) => {
      const updated = await this.groups.restore(requireUser(user).id, params.groupId);
      return { status: 200 as const, body: toGroupDto(updated) };
    });
  }

  @TsRestHandler(groupsContract.seed)
  seed(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.seed, async ({ params, body }) => {
      const result = await this.groups.seed(requireUser(user).id, params.groupId, body.language);
      return { status: 201 as const, body: result };
    });
  }

  @TsRestHandler(groupsContract.listMembers)
  listMembers(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.listMembers, async ({ params }) => {
      const members = await this.members.list(requireUser(user).id, params.groupId);
      return { status: 200 as const, body: members.map(toMemberDto) };
    });
  }

  @TsRestHandler(groupsContract.inviteMember)
  inviteMember(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.inviteMember, async ({ params, body }) => {
      const created = await this.members.inviteExisting(requireUser(user).id, params.groupId, body.email, body.role);
      return { status: 201 as const, body: toMemberDto(created) };
    });
  }

  @TsRestHandler(groupsContract.updateMemberRole)
  updateMemberRole(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.updateMemberRole, async ({ params, body }) => {
      const updated = await this.members.updateRole(requireUser(user).id, params.groupId, params.userId, body.role);
      return { status: 200 as const, body: toMemberDto(updated) };
    });
  }

  @TsRestHandler(groupsContract.removeMember)
  removeMember(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(groupsContract.removeMember, async ({ params }) => {
      const removed = await this.members.remove(requireUser(user).id, params.groupId, params.userId);
      return { status: 200 as const, body: toMemberDto(removed) };
    });
  }
}
