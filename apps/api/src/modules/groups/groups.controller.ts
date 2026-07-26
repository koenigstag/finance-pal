import { Controller, UnauthorizedException } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { groupsContract } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { GroupsService, type GroupWithRole } from './groups.service';

function toGroupDto({ group, role }: GroupWithRole) {
  return {
    id: group.id,
    name: group.name,
    ownerId: group.ownerId,
    archivedAt: group.archivedAt?.toISOString() ?? null,
    role,
  };
}

@Controller()
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

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
}

// JwtAuthGuard populates request.user for every non-@Public route, so this should be
// unreachable — it exists so the type is non-optional downstream without a cast that would
// silently produce `undefined.id` if the guard were ever detached from this controller.
function requireUser(user: RequestUser | undefined): RequestUser {
  if (!user) {
    throw new UnauthorizedException('Missing authenticated user');
  }
  return user;
}
