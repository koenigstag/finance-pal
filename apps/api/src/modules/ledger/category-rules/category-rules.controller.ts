import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { categoryRulesContract } from '@ft/shared-contracts';
import type { CategoryRule } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../../_core/authn/request-user';
import { requireUser } from '../../_core/authn/require-user';
import { CategoryRulesService } from './category-rules.service';

function toDto(rule: CategoryRule) {
  return {
    id: rule.id,
    groupId: rule.groupId,
    pattern: rule.pattern,
    categoryId: rule.categoryId,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

@Controller()
export class CategoryRulesController {
  constructor(private readonly rules: CategoryRulesService) {}

  @TsRestHandler(categoryRulesContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoryRulesContract.list, async ({ params }) => {
      const rules = await this.rules.list(requireUser(user).id, params.groupId);
      return { status: 200 as const, body: rules.map(toDto) };
    });
  }

  @TsRestHandler(categoryRulesContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoryRulesContract.create, async ({ params, body }) => {
      const rule = await this.rules.create(requireUser(user).id, params.groupId, body);
      return { status: 201 as const, body: toDto(rule) };
    });
  }

  @TsRestHandler(categoryRulesContract.update)
  update(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoryRulesContract.update, async ({ params, body }) => {
      const rule = await this.rules.update(requireUser(user).id, params.groupId, params.ruleId, body);
      return { status: 200 as const, body: toDto(rule) };
    });
  }

  @TsRestHandler(categoryRulesContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(categoryRulesContract.remove, async ({ params }) => {
      const rule = await this.rules.remove(requireUser(user).id, params.groupId, params.ruleId);
      return { status: 200 as const, body: toDto(rule) };
    });
  }
}
