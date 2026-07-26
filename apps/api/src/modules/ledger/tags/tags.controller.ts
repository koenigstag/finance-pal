import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { tagsContract } from '@ft/shared-contracts';
import { Tag } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../../_core/authn/request-user';
import { requireUser } from '../../_core/authn/require-user';
import { TagsService } from './tags.service';

function toTagDto(tag: Tag) {
  return {
    id: tag.id,
    groupId: tag.groupId,
    name: tag.name,
    createdAt: tag.createdAt.toISOString(),
  };
}

@Controller()
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @TsRestHandler(tagsContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(tagsContract.list, async ({ params }) => {
      const tags = await this.tags.list(requireUser(user).id, params.groupId);
      return { status: 200 as const, body: tags.map(toTagDto) };
    });
  }

  @TsRestHandler(tagsContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(tagsContract.create, async ({ params, body }) => {
      const created = await this.tags.create(requireUser(user).id, params.groupId, body.name);
      return { status: 201 as const, body: toTagDto(created) };
    });
  }

  @TsRestHandler(tagsContract.rename)
  rename(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(tagsContract.rename, async ({ params, body }) => {
      const updated = await this.tags.rename(requireUser(user).id, params.groupId, params.tagId, body.name);
      return { status: 200 as const, body: toTagDto(updated) };
    });
  }

  @TsRestHandler(tagsContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(tagsContract.remove, async ({ params }) => {
      const removed = await this.tags.remove(requireUser(user).id, params.groupId, params.tagId);
      return { status: 200 as const, body: toTagDto(removed) };
    });
  }
}
