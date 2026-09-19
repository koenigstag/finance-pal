import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { moneySchema } from '../common/money.schema.js';
import { errorSchema } from '../common/error.schema.js';
import { percentageSchema } from '../common/percentage.schema.js';
import { roundBalanceToSchema } from '../common/round-balance.schema.js';

const c = initContract();

export const TRANSACTION_TYPES = ['expense', 'income', 'transfer'] as const;
export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);

export const transactionSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  type: transactionTypeSchema,
  date: z.string().datetime(),
  amount: moneySchema,
  currencyId: z.number().int(),
  accountId: z.string().uuid(),
  // Always a top-level category.
  categoryId: z.string().uuid().nullable(),
  // One of categoryId's subcategories, or null when the transaction is filed under the category itself.
  subcategoryId: z.string().uuid().nullable(),
  toAccountId: z.string().uuid().nullable(),
  destAmount: moneySchema.nullable(),
  // Set when the amount was worked out as this percentage — of percentageBase when there is one
  // (the income a tax is a share of, say), otherwise of the account's balance (a card's monthly
  // charge on its debt). The client does the arithmetic; the API keeps the figures, so the
  // transaction reads as a percentage again when it's edited.
  percentage: percentageSchema.nullable(),
  // Only ever beside a percentage.
  percentageBase: moneySchema.nullable(),
  // Set, instead of a percentage, when the amount was worked out as whatever leaves the account's
  // balance on a multiple of this once the transaction goes through ("Round the balance"): down for
  // an expense or a transfer, up for an income.
  roundBalanceTo: roundBalanceToSchema.nullable(),
  // For an amount from the balance (a percentage of it with no base amount, or a rounding of it):
  // when it was last worked out. Earlier than `date`, it's an estimate (a planned transaction, or a
  // series' next occurrence) that the API works out again whenever the balance its date will have
  // changes, and a last time once that date comes, when it stays. Named before rounding came along.
  // Set by the API; bodies don't take it.
  percentageAsOf: z.string().datetime().nullable(),
  note: z.string().nullable(),
  tagIds: z.array(z.string().uuid()),
  // Set on occurrences a recurring rule materialized; null for hand-entered transactions.
  // Read-only: the create/update bodies below deliberately don't accept these.
  recurringRuleId: z.string().uuid().nullable(),
  // The occurrence's scheduled date, which stays put even if the user moves `date`.
  recurrenceDate: z.string().datetime().nullable(),
  // True once a user edited this occurrence directly; regenerating the series leaves it alone.
  isCustomized: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const createTransactionBodySchema = z.object({
  type: transactionTypeSchema,
  date: z.string().datetime(),
  amount: moneySchema,
  currencyId: z.number().int(),
  accountId: z.string().uuid(),
  // A top-level category. A subcategory given here instead is filed as that subcategory under its
  // parent, which is how clients from before subcategoryId picked one.
  categoryId: z.string().uuid().nullable().optional(),
  // Must be one of categoryId's subcategories. Left out of an update, it stays while the category
  // does and is cleared when the category changes.
  subcategoryId: z.string().uuid().nullable().optional(),
  toAccountId: z.string().uuid().nullable().optional(),
  destAmount: moneySchema.nullable().optional(),
  // Above 0 and at most 100. Recorded as sent, beside the amount: it isn't checked against it.
  percentage: percentageSchema.nullable().optional(),
  // Above 0, and only with a percentage. Left out of an update, it stays while the percentage does
  // and is cleared along with it.
  percentageBase: moneySchema.nullable().optional(),
  // Instead of a percentage, never beside one. An update naming either leaves the other out.
  roundBalanceTo: roundBalanceToSchema.nullable().optional(),
  note: z.string().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

const updateTransactionBodySchema = createTransactionBodySchema.partial();

const transactionListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  accountId: z.string().uuid().optional(),
  // A category or a subcategory; a category matches its subcategories' transactions as well.
  categoryId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  type: transactionTypeSchema.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  search: z.string().optional(),
});

const transactionListResponseSchema = z.object({
  items: z.array(transactionSchema),
  nextCursor: z.string().nullable(),
});

const groupPathParams = z.object({ groupId: z.string().uuid() });
const transactionPathParams = z.object({ groupId: z.string().uuid(), transactionId: z.string().uuid() });

export const transactionsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups/:groupId/transactions',
      pathParams: groupPathParams,
      query: transactionListQuerySchema,
      responses: { 200: transactionListResponseSchema, 400: errorSchema, 404: errorSchema },
      summary: 'List transactions in a group, cursor-paginated by date desc, filterable',
    },
    create: {
      method: 'POST',
      path: '/groups/:groupId/transactions',
      pathParams: groupPathParams,
      body: createTransactionBodySchema,
      responses: { 201: transactionSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Create a transaction (expense/income/transfer)',
    },
    get: {
      method: 'GET',
      path: '/groups/:groupId/transactions/:transactionId',
      pathParams: transactionPathParams,
      responses: { 200: transactionSchema, 404: errorSchema },
      summary: 'Get one transaction',
    },
    update: {
      method: 'PATCH',
      path: '/groups/:groupId/transactions/:transactionId',
      pathParams: transactionPathParams,
      body: updateTransactionBodySchema,
      responses: { 200: transactionSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Update a transaction',
    },
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/transactions/:transactionId',
      pathParams: transactionPathParams,
      responses: { 200: transactionSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Soft-delete a transaction',
    },
  },
  { pathPrefix: '/api' },
);
