import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { budgetsContract } from '@ft/shared-contracts';
import type { Budget } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../../_core/authn/request-user';
import { requireUser } from '../../_core/authn/require-user';
import { BudgetsService } from './budgets.service';

function toDto(budget: Budget) {
  return {
    id: budget.id,
    groupId: budget.groupId,
    // The date column holds the month's first day.
    month: budget.month.slice(0, 7),
    categoryId: budget.categoryId,
    accountId: budget.accountId,
    amount: budget.amount,
    currencyId: budget.currencyId,
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
}

@Controller()
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @TsRestHandler(budgetsContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(budgetsContract.list, async ({ params, query }) => {
      const budgets = await this.budgets.list(requireUser(user).id, params.groupId, query.month);
      return { status: 200 as const, body: budgets.map(toDto) };
    });
  }

  @TsRestHandler(budgetsContract.totals)
  totals(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(budgetsContract.totals, async ({ params, query }) => {
      const totals = await this.budgets.totals(requireUser(user).id, params.groupId, query.dateFrom, query.dateTo);
      return { status: 200 as const, body: totals };
    });
  }

  @TsRestHandler(budgetsContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(budgetsContract.create, async ({ params, body }) => {
      const budget = await this.budgets.create(requireUser(user).id, params.groupId, body);
      return { status: 201 as const, body: toDto(budget) };
    });
  }

  @TsRestHandler(budgetsContract.update)
  update(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(budgetsContract.update, async ({ params, body }) => {
      const budget = await this.budgets.update(requireUser(user).id, params.groupId, params.budgetId, body.amount);
      return { status: 200 as const, body: toDto(budget) };
    });
  }

  @TsRestHandler(budgetsContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(budgetsContract.remove, async ({ params }) => {
      const budget = await this.budgets.remove(requireUser(user).id, params.groupId, params.budgetId);
      return { status: 200 as const, body: toDto(budget) };
    });
  }
}
