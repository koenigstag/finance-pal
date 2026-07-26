import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { categoriesContract } from '@ft/shared-contracts';
import { Category } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../../_core/authn/request-user';
import { requireUser } from '../../_core/authn/require-user';
import { CategoriesService } from './categories.service';

function toCategoryDto(category: Category) {
  return {
    id: category.id,
    groupId: category.groupId,
    parentId: category.parentId,
    type: category.type,
    name: category.name,
    icon: category.icon,
    color: category.color,
    sortOrder: category.sortOrder,
    archived: category.archived,
    archivedAt: category.archivedAt?.toISOString() ?? null,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

@Controller()
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @TsRestHandler(categoriesContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoriesContract.list, async ({ params, query }) => {
      const categories = await this.categories.list(
        requireUser(user).id,
        params.groupId,
        query.includeArchived ?? false,
      );
      return { status: 200 as const, body: categories.map(toCategoryDto) };
    });
  }

  @TsRestHandler(categoriesContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoriesContract.create, async ({ params, body }) => {
      const created = await this.categories.create(requireUser(user).id, params.groupId, body);
      return { status: 201 as const, body: toCategoryDto(created) };
    });
  }

  @TsRestHandler(categoriesContract.get)
  get(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoriesContract.get, async ({ params }) => {
      const category = await this.categories.get(requireUser(user).id, params.groupId, params.categoryId);
      return { status: 200 as const, body: toCategoryDto(category) };
    });
  }

  @TsRestHandler(categoriesContract.update)
  update(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoriesContract.update, async ({ params, body }) => {
      const updated = await this.categories.update(requireUser(user).id, params.groupId, params.categoryId, body);
      return { status: 200 as const, body: toCategoryDto(updated) };
    });
  }

  @TsRestHandler(categoriesContract.archive)
  archive(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoriesContract.archive, async ({ params }) => {
      const updated = await this.categories.archive(requireUser(user).id, params.groupId, params.categoryId);
      return { status: 200 as const, body: toCategoryDto(updated) };
    });
  }

  @TsRestHandler(categoriesContract.restore)
  restore(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoriesContract.restore, async ({ params }) => {
      const updated = await this.categories.restore(requireUser(user).id, params.groupId, params.categoryId);
      return { status: 200 as const, body: toCategoryDto(updated) };
    });
  }

  @TsRestHandler(categoriesContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoriesContract.remove, async ({ params }) => {
      const removed = await this.categories.remove(requireUser(user).id, params.groupId, params.categoryId);
      return { status: 200 as const, body: toCategoryDto(removed) };
    });
  }
}
