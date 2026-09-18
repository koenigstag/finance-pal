import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { recurringRulesContract } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { toTransactionDto, withoutTrailingZeros } from '../ledger/transactions/transaction.dto';
import { RecurringRulesService, type RecurringRuleView } from './recurring-rules.service';

function toRecurringRuleDto({ rule, nextOccurrence }: RecurringRuleView) {
  return {
    id: rule.id,
    groupId: rule.groupId,
    type: rule.type,
    amount: rule.amount,
    currencyId: rule.currencyId,
    accountId: rule.accountId,
    categoryId: rule.categoryId,
    subcategoryId: rule.subcategoryId,
    toAccountId: rule.toAccountId,
    note: rule.note,
    percentage: rule.percentage === null ? null : withoutTrailingZeros(rule.percentage),
    percentageBase: rule.percentageBase,
    intervalUnit: rule.intervalUnit,
    intervalValue: rule.intervalValue,
    startsAt: rule.startsAt.toISOString(),
    nextRunDate: rule.nextRunDate.toISOString(),
    nextOccurrence: nextOccurrence?.toISOString() ?? null,
    reminderDaysBefore: rule.reminderDaysBefore,
    timezone: rule.timezone,
    active: rule.active,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

@Controller()
export class RecurringRulesController {
  constructor(private readonly rules: RecurringRulesService) {}

  @TsRestHandler(recurringRulesContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(recurringRulesContract.list, async ({ params, query }) => {
      const rules = await this.rules.list(requireUser(user).id, params.groupId, query.includeInactive ?? false);
      return { status: 200 as const, body: rules.map(toRecurringRuleDto) };
    });
  }

  // Must stay above get(): Nest registers routes in method order, and /recurring-rules/upcoming
  // would otherwise be taken as /recurring-rules/:ruleId and rejected as a non-uuid.
  @TsRestHandler(recurringRulesContract.upcoming)
  upcoming(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(recurringRulesContract.upcoming, async ({ params }) => {
      const occurrences = await this.rules.upcoming(requireUser(user).id, params.groupId);
      // Materialized occurrences never carry tags — rules have none to copy.
      return { status: 200 as const, body: occurrences.map((t) => toTransactionDto(t, [])) };
    });
  }

  @TsRestHandler(recurringRulesContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(recurringRulesContract.create, async ({ params, body }) => {
      const created = await this.rules.create(requireUser(user).id, params.groupId, body);
      return { status: 201 as const, body: toRecurringRuleDto(created) };
    });
  }

  @TsRestHandler(recurringRulesContract.get)
  get(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(recurringRulesContract.get, async ({ params }) => {
      const rule = await this.rules.get(requireUser(user).id, params.groupId, params.ruleId);
      return { status: 200 as const, body: toRecurringRuleDto(rule) };
    });
  }

  @TsRestHandler(recurringRulesContract.update)
  update(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(recurringRulesContract.update, async ({ params, body }) => {
      const updated = await this.rules.update(requireUser(user).id, params.groupId, params.ruleId, body);
      return { status: 200 as const, body: toRecurringRuleDto(updated) };
    });
  }

  @TsRestHandler(recurringRulesContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(recurringRulesContract.remove, async ({ params, query }) => {
      const removed = await this.rules.remove(requireUser(user).id, params.groupId, params.ruleId, query.keepPlanned ?? false);
      return { status: 200 as const, body: toRecurringRuleDto(removed) };
    });
  }
}
