import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { moneySchema } from '../common/money.schema.js';
import { errorSchema } from '../common/error.schema.js';

const c = initContract();

export const ACCOUNT_TYPES = ['regular', 'debt', 'savings'] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);

export const accountSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  type: accountTypeSchema,
  name: z.string().min(1).max(120),
  currencyId: z.number().int(),
  isFavourite: z.boolean(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  description: z.string().nullable(),
  isIncludedInBalance: z.boolean(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  archivedAt: z.string().datetime().nullable(),
  cachedBalance: moneySchema,
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
  icon: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
  isIncludedInBalance: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const updateAccountBodySchema = createAccountBodySchema.partial();

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
      query: z.object({ includeArchived: z.coerce.boolean().optional() }),
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
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/accounts/:accountId',
      pathParams: accountPathParams,
      responses: { 200: accountSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Soft-delete an account',
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
