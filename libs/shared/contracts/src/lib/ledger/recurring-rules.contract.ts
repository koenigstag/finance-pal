import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { booleanQuerySchema } from '../common/boolean-query.schema.js';
import { moneySchema } from '../common/money.schema.js';
import { errorSchema } from '../common/error.schema.js';
import { percentageSchema } from '../common/percentage.schema.js';
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
  // The pair as on a transaction: a top-level category and, optionally, one of its subcategories.
  categoryId: z.string().uuid().nullable(),
  subcategoryId: z.string().uuid().nullable(),
  toAccountId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  // As on a transaction. Each occurrence's amount is worked out as this percentage: of
  // percentageBase if set, the same every time, otherwise of the account's balance on the
  // occurrence's date. `amount` is then what it came to when the series was saved.
  percentage: percentageSchema.nullable(),
  percentageBase: moneySchema.nullable(),
  intervalUnit: recurrenceUnitSchema,
  intervalValue: z.number().int(),
  // Anchor of the series: occurrence k = startsAt + k·interval.
  startsAt: z.string().datetime(),
  // First occurrence not yet materialized as a transaction — an implementation detail of the
  // scheduler, not "the next payment": that one is nextOccurrence.
  nextRunDate: z.string().datetime(),
  // A series keeps one occurrence ahead of now as a planned transaction, and writes the next once
  // that one's date passes. This is when it next produces one: the planned occurrence's scheduled
  // date (a user may have moved the transaction itself), or the schedule's next date in the
  // moments before it's written. Null for a paused rule.
  nextOccurrence: z.string().datetime().nullable(),
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
  // Read the same way as on a transaction's body.
  categoryId: z.string().uuid().nullable().optional(),
  subcategoryId: z.string().uuid().nullable().optional(),
  toAccountId: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
  // Read the same way as on a transaction's body; amount is then what it comes to now.
  percentage: percentageSchema.nullable().optional(),
  percentageBase: moneySchema.nullable().optional(),
  intervalUnit: recurrenceUnitSchema,
  intervalValue: z.number().int().min(1).optional(),
  startsAt: z.string().datetime(),
  reminderDaysBefore: z.number().int().min(0).nullable().optional(),
  timezone: timezoneSchema.optional(),
  // A planned one-off transaction the series takes the place of, usually the one dated startsAt:
  // it's deleted in the same change, and the series writes its first occurrence instead.
  replacesTransactionId: z.string().uuid().optional(),
});

const updateRecurringRuleBodySchema = createRecurringRuleBodySchema.omit({ replacesTransactionId: true }).partial().extend({
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
      summary:
        'Create a recurring rule; its occurrences up to the first one ahead of now are created as transactions, a start date in the past included',
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
      // keepPlanned: the series' occurrences still ahead stay, as transactions of their own, rather
      // than going with it — how a series ends after its planned transaction.
      query: z.object({ keepPlanned: booleanQuerySchema.optional() }),
      responses: { 200: recurringRuleSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Soft-delete a rule and remove its future occurrences nobody edited, or keep them as one-offs',
    },
  },
  { pathPrefix: '/api' },
);
