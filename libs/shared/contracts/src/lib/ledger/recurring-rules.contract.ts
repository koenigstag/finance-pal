import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { booleanQuerySchema } from '../common/boolean-query.schema.js';
import { moneySchema } from '../common/money.schema.js';
import { errorSchema } from '../common/error.schema.js';
import { timezoneSchema } from '../common/timezone.schema.js';
import { transactionSchema, transactionTypeSchema } from './transactions.contract.js';

const c = initContract();

export const RECURRENCE_UNITS = ['day', 'week', 'month', 'year'] as const;
export const recurrenceUnitSchema = z.enum(RECURRENCE_UNITS);

export const recurringRuleSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  type: transactionTypeSchema,
  amount: moneySchema,
  currencyId: z.number().int(),
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  toAccountId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  intervalUnit: recurrenceUnitSchema,
  intervalValue: z.number().int(),
  // Anchor of the series: occurrence k = startsAt + k·interval.
  startsAt: z.string().datetime(),
  // First occurrence not yet materialized as a transaction — an implementation detail of the
  // scheduler, not "the next payment": that one is the earliest future occurrence in transactions.
  nextRunDate: z.string().datetime(),
  reminderDaysBefore: z.number().int().nullable(),
  timezone: z.string(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const createRecurringRuleBodySchema = z.object({
  type: transactionTypeSchema,
  amount: moneySchema,
  currencyId: z.number().int(),
  accountId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  toAccountId: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
  intervalUnit: recurrenceUnitSchema,
  intervalValue: z.number().int().min(1).optional(),
  startsAt: z.string().datetime(),
  reminderDaysBefore: z.number().int().min(0).nullable().optional(),
  timezone: timezoneSchema.optional(),
});

const updateRecurringRuleBodySchema = createRecurringRuleBodySchema.partial().extend({
  // false pauses the series (its not-yet-happened occurrences are removed); true resumes it.
  active: z.boolean().optional(),
});

const groupPathParams = z.object({ groupId: z.string().uuid() });
const rulePathParams = z.object({ groupId: z.string().uuid(), ruleId: z.string().uuid() });

export const recurringRulesContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups/:groupId/recurring-rules',
      pathParams: groupPathParams,
      query: z.object({ includeInactive: booleanQuerySchema.optional() }),
      responses: { 200: z.array(recurringRuleSchema), 404: errorSchema },
      summary: 'List recurring rules in a group (paused ones hidden by default)',
    },
    // Shares a prefix with /:ruleId, which it would be matched as (and fail uuid validation with a
    // 400) if that route were registered first — the controller's handler order is what counts.
    upcoming: {
      method: 'GET',
      path: '/groups/:groupId/recurring-rules/upcoming',
      pathParams: groupPathParams,
      responses: { 200: z.array(transactionSchema), 404: errorSchema },
      summary: "Future occurrences inside their rule's reminder window (reminderDaysBefore), soonest first",
    },
    create: {
      method: 'POST',
      path: '/groups/:groupId/recurring-rules',
      pathParams: groupPathParams,
      body: createRecurringRuleBodySchema,
      responses: { 201: recurringRuleSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Create a recurring rule; its occurrences through the end of next month are created as transactions',
    },
    get: {
      method: 'GET',
      path: '/groups/:groupId/recurring-rules/:ruleId',
      pathParams: rulePathParams,
      responses: { 200: recurringRuleSchema, 404: errorSchema },
      summary: 'Get one recurring rule',
    },
    update: {
      method: 'PATCH',
      path: '/groups/:groupId/recurring-rules/:ruleId',
      pathParams: rulePathParams,
      body: updateRecurringRuleBodySchema,
      responses: { 200: recurringRuleSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Update a rule; future occurrences nobody edited are regenerated',
    },
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/recurring-rules/:ruleId',
      pathParams: rulePathParams,
      responses: { 200: recurringRuleSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Soft-delete a rule and remove its future occurrences nobody edited',
    },
  },
  { pathPrefix: '/api' },
);
