import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';
import { moneySchema, signedMoneySchema } from '../common/money.schema.js';

const c = initContract();

// A calendar month, as YYYY-MM.
export const budgetMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM');

/**
 * One line of a group's budget for a month: how much is meant to be spent from an expense category,
 * received into an income category, or put into a debt or savings account. Each month is set on its
 * own; a month nobody set has no lines.
 */
export const budgetSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  month: budgetMonthSchema,
  // Exactly one of the two. A category is always a top-level one: its subcategories count toward it.
  categoryId: z.string().uuid().nullable(),
  // A debt or savings account.
  accountId: z.string().uuid().nullable(),
  amount: moneySchema,
  // The account's own currency for an account. For a category, the main currency of whoever last
  // set the amount.
  currencyId: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const createBudgetBodySchema = z.object({
  month: budgetMonthSchema,
  // One of the two, never both.
  categoryId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  amount: moneySchema,
});

/**
 * What moved in a stretch of time, for measuring a budget against. Recorded is what is dated up to
 * now, planned what is dated later (scheduled transactions, a series' next occurrence).
 */
export const budgetTotalsSchema = z.object({
  // Expenses and incomes by top-level category (a subcategory's count toward its parent), in each
  // currency they were recorded in. A null category is the transactions filed under none.
  categories: z.array(
    z.object({
      categoryId: z.string().uuid().nullable(),
      type: z.enum(['expense', 'income']),
      currencyId: z.number().int(),
      recorded: moneySchema,
      planned: moneySchema,
    }),
  ),
  // How much each account's balance changed, in its own currency: what went in less what came out.
  // Only accounts something happened on.
  accounts: z.array(
    z.object({
      accountId: z.string().uuid(),
      recorded: signedMoneySchema,
      planned: signedMoneySchema,
    }),
  ),
});

const groupPathParams = z.object({ groupId: z.string().uuid() });
const budgetPathParams = z.object({ groupId: z.string().uuid(), budgetId: z.string().uuid() });

export const budgetsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups/:groupId/budgets',
      pathParams: groupPathParams,
      query: z.object({ month: budgetMonthSchema }),
      responses: { 200: z.array(budgetSchema), 404: errorSchema },
      summary: "A month's budget lines",
    },
    totals: {
      method: 'GET',
      path: '/groups/:groupId/budgets/totals',
      pathParams: groupPathParams,
      // The month's bounds in the caller's time zone, as the transactions list takes them.
      query: z.object({ dateFrom: z.string().datetime(), dateTo: z.string().datetime() }),
      responses: { 200: budgetTotalsSchema, 404: errorSchema },
      summary: 'What was spent and received by category, and put into each account, between two moments',
    },
    create: {
      method: 'POST',
      path: '/groups/:groupId/budgets',
      pathParams: groupPathParams,
      body: createBudgetBodySchema,
      responses: { 201: budgetSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema },
      summary:
        'Budget an amount for a top-level category, or a debt or savings account, in a month; a second line for the same one in that month is refused',
    },
    update: {
      method: 'PATCH',
      path: '/groups/:groupId/budgets/:budgetId',
      pathParams: budgetPathParams,
      body: z.object({ amount: moneySchema }),
      responses: { 200: budgetSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: "Change a budget line's amount; a category's is then in the caller's main currency",
    },
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/budgets/:budgetId',
      pathParams: budgetPathParams,
      responses: { 200: budgetSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Take a line out of the budget',
    },
  },
  { pathPrefix: '/api' },
);
