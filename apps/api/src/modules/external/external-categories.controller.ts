import { Controller, NotFoundException } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { externalContract } from '@ft/shared-contracts';
import { ApiKeyAuth } from '../_core/authn/api-key-auth.decorator';
import { CurrentApiKey, type RequestApiKey } from '../_core/authn/request-user';
import { requireApiKey } from '../_core/authn/require-api-key';
import { CategoriesService } from '../ledger/categories/categories.service';
import { toExternalCategory } from './external.dto';
import { ExternalLookupService } from './external-lookup.service';
import { findParentId } from './references';

const routes = externalContract.categories;

@Controller()
export class ExternalCategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly lookup: ExternalLookupService,
  ) {}

  @ApiKeyAuth(routes.list)
  @TsRestHandler(routes.list)
  list(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.list, async ({ query }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      const categories = await this.categories.list(userId, groupId, query.includeArchived ?? false);
      const ofType = query.type ? categories.filter((category) => category.type === query.type) : categories;
      return { status: 200 as const, body: ofType.map(toExternalCategory) };
    });
  }

  @ApiKeyAuth(routes.get)
  @TsRestHandler(routes.get)
  get(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.get, async ({ params }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      const category = await this.categories.get(userId, groupId, params.categoryId);
      return { status: 200 as const, body: toExternalCategory(category) };
    });
  }

  @ApiKeyAuth(routes.create)
  @TsRestHandler(routes.create)
  create(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.create, async ({ body }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      const parentId =
        body.parentName === undefined
          ? body.parentId
          : findParentId(await this.lookup.categoriesOf(groupId), body.type, body.parentId, body.parentName);
      const created = await this.categories.create(userId, groupId, { name: body.name, type: body.type, parentId });
      return { status: 201 as const, body: toExternalCategory(created) };
    });
  }

  @ApiKeyAuth(routes.update)
  @TsRestHandler(routes.update)
  update(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.update, async ({ params, body }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      let parentId = body.parentId;
      if (body.parentName !== undefined) {
        // A parent is looked up among categories of the same type, which only the stored one knows.
        const categories = await this.lookup.categoriesOf(groupId);
        const category = categories.find((candidate) => candidate.id === params.categoryId);
        if (!category) {
          throw new NotFoundException('Category not found');
        }
        parentId = findParentId(categories, category.type, body.parentId, body.parentName);
      }
      // Only what the request names: a key present with undefined in a TypeORM update is best avoided.
      const patch: { name?: string; parentId?: string | null } = {};
      if (body.name !== undefined) {
        patch.name = body.name;
      }
      if (parentId !== undefined) {
        patch.parentId = parentId;
      }
      const updated = await this.categories.update(userId, groupId, params.categoryId, patch);
      return { status: 200 as const, body: toExternalCategory(updated) };
    });
  }
}
