import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { booleanQuerySchema } from '../common/boolean-query.schema.js';
import { moneySchema, signedMoneySchema } from '../common/money.schema.js';
import { errorSchema } from '../common/error.schema.js';
import { notificationBankSchema } from '../external/notification-banks.js';

const c = initContract();

export const ACCOUNT_TYPES = ['regular', 'debt', 'savings'] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);

export const accountSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  type: accountTypeSchema,
  name: z.string().min(1).max(120),
  currencyId: z.number().int(),
  // At most one per group: marking an account unmarks the others.
  isFavourite: z.boolean(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  description: z.string().nullable(),
  isIncludedInBalance: z.boolean(),
  // The bank whose notifications, forwarded to the external API, are recorded on this account.
  notificationBank: notificationBankSchema.nullable(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  archivedAt: z.string().datetime().nullable(),
  // Excludes transactions dated in the future (e.g. planned recurring occurrences).
  balance: signedMoneySchema,
  // Includes them — what the account will hold once everything already scheduled has happened.
  plannedBalance: signedMoneySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const accountTargetSchema = z.object({
  accountId: z.string().uuid(),
  limitAmount: moneySchema.nullable(),
  goalAmount: moneySchema.nullable(),
});

const createAccountBodySchema = z.object({
  type: accountTypeSchema.optional(),
  name: z.string().min(1).max(120),
  currencyId: z.number().int(),
  isFavourite: z.boolean().optional(),
  // A name from the client's icon set (e.g. "wallet"); null clears it.
  icon: z.string().min(1).max(40).nullable().optional(),
  // #RRGGBB; null clears it.
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be #RRGGBB')
    .nullable()
    .optional(),
  description: z.string().optional(),
  isIncludedInBalance: z.boolean().optional(),
  // null: none.
  notificationBank: notificationBankSchema.nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const updateAccountBodySchema = createAccountBodySchema.partial();

// What deleting an account takes with it, for the confirmation shown before doing so.
export const accountUsageSchema = z.object({
  // Transactions on the account that already happened, transfers into it from other accounts
  // included.
  transactionCount: z.number().int(),
  // Future-dated ones, mostly occurrences recurring rules scheduled ahead — reported apart so a
  // confirmation doesn't present projections as history.
  plannedTransactionCount: z.number().int(),
  // Recurring rules that draw from or pay into it.
  recurringRuleCount: z.number().int(),
});

const upsertAccountTargetBodySchema = z.object({
  limitAmount: moneySchema.nullable().optional(),
  goalAmount: moneySchema.nullable().optional(),
});

const groupPathParams = z.object({ groupId: z.string().uuid() });
const accountPathParams = z.object({ groupId: z.string().uuid(), accountId: z.string().uuid() });

export const accountsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups/:groupId/accounts',
      pathParams: groupPathParams,
      query: z.object({ includeArchived: booleanQuerySchema.optional() }),
      responses: { 200: z.array(accountSchema), 404: errorSchema },
      summary: 'List accounts in a group (archived hidden by default)',
    },
    create: {
      method: 'POST',
      path: '/groups/:groupId/accounts',
      pathParams: groupPathParams,
      body: createAccountBodySchema,
      responses: { 201: accountSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Create an account in a group',
    },
    get: {
      method: 'GET',
      path: '/groups/:groupId/accounts/:accountId',
      pathParams: accountPathParams,
      responses: { 200: accountSchema, 404: errorSchema },
      summary: 'Get one account',
    },
    update: {
      method: 'PATCH',
      path: '/groups/:groupId/accounts/:accountId',
      pathParams: accountPathParams,
      body: updateAccountBodySchema,
      responses: { 200: accountSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Update an account',
    },
    archive: {
      method: 'POST',
      path: '/groups/:groupId/accounts/:accountId/archive',
      pathParams: accountPathParams,
      body: z.object({}),
      responses: { 200: accountSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Archive an account (hide it from default listings, keep its history)',
    },
    restore: {
      method: 'POST',
      path: '/groups/:groupId/accounts/:accountId/restore',
      pathParams: accountPathParams,
      body: z.object({}),
      responses: { 200: accountSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Restore an archived account',
    },
    usage: {
      method: 'GET',
      path: '/groups/:groupId/accounts/:accountId/usage',
      pathParams: accountPathParams,
      responses: { 200: accountUsageSchema, 404: errorSchema },
      summary: 'Count the transactions and recurring rules that deleting the account would remove',
    },
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/accounts/:accountId',
      pathParams: accountPathParams,
      responses: { 200: accountSchema, 403: errorSchema, 404: errorSchema },
      summary:
        'Delete an account together with its transactions (transfers to and from it included) and the recurring rules using it',
    },
    upsertTarget: {
      method: 'PATCH',
      path: '/groups/:groupId/accounts/:accountId/target',
      pathParams: accountPathParams,
      body: upsertAccountTargetBodySchema,
      responses: { 200: accountTargetSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Create or update the limit/goal amounts for a debt/savings account',
    },
  },
  { pathPrefix: '/api' },
);
