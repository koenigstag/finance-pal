import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { apiKeyScopeSchema, type ApiKeyScope } from '../api-keys/api-key-scopes.js';
import { MEMBER_ROLES } from '../authz/ability.js';
import { booleanQuerySchema } from '../common/boolean-query.schema.js';
import { errorSchema } from '../common/error.schema.js';
import { moneySchema, parseMoneyInput, signedMoneySchema } from '../common/money.schema.js';
import { accountTypeSchema } from '../ledger/accounts.contract.js';
import { categoryTypeSchema } from '../ledger/categories.contract.js';
import { transactionTypeSchema } from '../ledger/transactions.contract.js';
import { notificationBankSchema } from './notification-banks.js';

const c = initContract();

/**
 * The API other apps use: phone automations turning bank notifications into transactions,
 * scripts, spreadsheets. Separate from the routes the web app calls, and versioned, because its
 * clients can't all be updated at once when something here changes.
 *
 * Callers authenticate with an API key (Authorization: Bearer fpk_…, or X-Api-Key: fpk_…), which
 * is also the only thing that works here: access tokens are refused, as are keys everywhere else.
 * A key belongs to one group, so no route names a group. It acts as the person who made it —
 * never beyond their role in the group — and only within its scopes: each route's metadata says
 * which scope it needs.
 *
 * Wherever a body refers to an account or a category, it may give the id or the name (compared
 * without regard to case or surrounding spaces), not both. When active and archived ones share a
 * name, the active one is meant; a name several active ones share is refused, asking for the id.
 */
export interface ExternalRouteMetadata {
  // null: any valid key may call the route.
  scope: ApiKeyScope | null;
}

const needs = (scope: ApiKeyScope | null) => ({ metadata: { scope } satisfies ExternalRouteMetadata });

// Amounts as other apps send them: a JSON number, or text the way a bank notification prints it
// ("1 250,50"). Read by the parser behind the app's own amount fields, so both refuse the same
// ambiguous input ("1.234") rather than guess.
export const externalAmountSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const amount = parseMoneyInput(String(value));
  if (amount === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expected an amount like "125.50" or "1 250,50": digits, spaces between groups, up to two decimals',
    });
    return z.NEVER;
  }
  return amount;
});

// With a UTC offset: "2026-09-18T14:05:00+03:00" or "2026-09-18T11:05:00Z".
const dateTimeSchema = z.string().datetime({ offset: true });
const nameSchema = z.string().trim().min(1).max(120);
const currencyCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'Expected an ISO 4217 currency code, like "UAH"')
  .transform((code) => code.toUpperCase());

// A key the client picks for a request it may send more than once: a request repeating one the
// group has already had records nothing new, and gets the transaction the first one recorded.
// Any text up to 1000 characters — only its digest is kept — so a notification's own text can be
// the key. The header's quoted form ("…") is the same key as the bare one.
export const idempotencyKeySchema = z.string().trim().min(1).max(1000);
const idempotencyHeaderSchema = z
  .string()
  .transform((value) => value.trim().replace(/^"(.*)"$/, '$1'))
  .pipe(idempotencyKeySchema);

export const externalKeySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  expiresAt: z.string().datetime().nullable(),
  group: z.object({
    id: z.string().uuid(),
    name: z.string(),
    // The key owner's role there. A viewer's key only reads, whatever its scopes.
    role: z.enum(MEMBER_ROLES),
    // An archived group is read-only, for keys as well.
    archived: z.boolean(),
  }),
});

export const externalAccountSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: accountTypeSchema,
  // ISO 4217 code. The account's transactions are all recorded in it.
  currency: z.string(),
  // Excludes transactions dated in the future; plannedBalance includes them.
  balance: signedMoneySchema,
  plannedBalance: signedMoneySchema,
  // Where a transaction goes when its request names no account.
  isFavourite: z.boolean(),
  isIncludedInBalance: z.boolean(),
  archived: z.boolean(),
  description: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const externalCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: categoryTypeSchema,
  // Set on a subcategory: its top-level category. Categories are two levels deep.
  parentId: z.string().uuid().nullable(),
  archived: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const externalTransactionSchema = z.object({
  id: z.string().uuid(),
  type: transactionTypeSchema,
  date: z.string().datetime(),
  amount: moneySchema,
  // The account's currency.
  currency: z.string(),
  accountId: z.string().uuid(),
  // Expenses and income: a top-level category, and optionally one of its subcategories.
  categoryId: z.string().uuid().nullable(),
  subcategoryId: z.string().uuid().nullable(),
  // Transfers: the receiving account, and what arrived when its currency differs.
  toAccountId: z.string().uuid().nullable(),
  destAmount: moneySchema.nullable(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const createAccountBodySchema = z.object({
  name: nameSchema,
  currency: currencyCodeSchema,
  type: accountTypeSchema.optional(),
  description: z.string().max(1000).optional(),
  isIncludedInBalance: z.boolean().optional(),
  // Marking one account unmarks the others.
  isFavourite: z.boolean().optional(),
});

// The currency stays: the account's transactions were recorded in it.
const updateAccountBodySchema = createAccountBodySchema.omit({ currency: true }).partial();

const createCategoryBodySchema = z.object({
  name: nameSchema,
  type: categoryTypeSchema,
  // Makes it a subcategory of this top-level category, which must be of the same type.
  parentId: z.string().uuid().optional(),
  parentName: nameSchema.optional(),
});

// The type stays. parentId null makes a subcategory top-level.
const updateCategoryBodySchema = z.object({
  name: nameSchema.optional(),
  parentId: z.string().uuid().nullable().optional(),
  parentName: nameSchema.optional(),
});

const createTransactionBodySchema = z.object({
  type: transactionTypeSchema,
  amount: externalAmountSchema,
  // Left out: the moment the request arrives.
  date: dateTimeSchema.optional(),
  // Left out: the group's favourite account. The transaction is in this account's currency.
  accountId: z.string().uuid().optional(),
  accountName: nameSchema.optional(),
  // Transfers only, and required there: where the money goes.
  toAccountId: z.string().uuid().optional(),
  toAccountName: nameSchema.optional(),
  // Transfers between accounts in different currencies only, and required there: what arrived.
  destAmount: externalAmountSchema.optional(),
  // Expenses and income only, and optional: a category of the transaction's type. A subcategory
  // named here is filed under its parent; a subcategory named alone finds its parent itself, when
  // no other subcategory has that name.
  categoryId: z.string().uuid().optional(),
  categoryName: nameSchema.optional(),
  subcategoryId: z.string().uuid().optional(),
  subcategoryName: nameSchema.optional(),
  note: z.string().max(1000).optional(),
  // The Idempotency-Key header's twin, for keys a header can't carry: HTTP clients on Android
  // refuse a header with Cyrillic in it, for one. Both at once must agree.
  idempotencyKey: idempotencyKeySchema.optional(),
});

// What a request leaves out stays as it was, and the type can't change. A new category drops a
// subcategory the request doesn't restate, null clears either, and an empty note clears the note.
const updateTransactionBodySchema = createTransactionBodySchema
  .omit({ type: true, idempotencyKey: true })
  .extend({
    categoryId: z.string().uuid().nullable().optional(),
    subcategoryId: z.string().uuid().nullable().optional(),
  })
  .partial();

// A bank's notification, forwarded as the phone shows it by an automation that knows nothing
// else: which bank sent it, and its text. The API reads the text the way that bank writes them —
// which way the money went, how much, who to — and records it on the account that receives the
// bank's notifications.
const forwardNotificationBodySchema = z.object({
  type: notificationBankSchema,
  // Line breaks may stay. Only its digest is kept, as the idempotency key: a notification the
  // bank posts twice records one transaction.
  text: z.string().trim().min(1).max(2000),
});

// A notification that moves no money — a code, an ad, a declined payment — records nothing.
export const skippedNotificationSchema = z.object({
  recorded: z.literal(false),
  reason: z.string(),
});

const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema } as const;
const readErrors = { 401: errorSchema, 403: errorSchema, 404: errorSchema } as const;

const accountPathParams = z.object({ accountId: z.string().uuid() });
const categoryPathParams = z.object({ categoryId: z.string().uuid() });
const transactionPathParams = z.object({ transactionId: z.string().uuid() });

export const externalContract = c.router(
  {
    key: {
      method: 'GET',
      path: '/key',
      responses: { 200: externalKeySchema, 401: errorSchema },
      summary: 'The key making the request: its scopes, and the group it works in',
      ...needs(null),
    },
    accounts: c.router({
      list: {
        method: 'GET',
        path: '/accounts',
        query: z.object({ includeArchived: booleanQuerySchema.optional() }),
        responses: { 200: z.array(externalAccountSchema), ...readErrors },
        summary: 'List accounts, archived ones only when asked for',
        ...needs('accounts:read'),
      },
      get: {
        method: 'GET',
        path: '/accounts/:accountId',
        pathParams: accountPathParams,
        responses: { 200: externalAccountSchema, ...readErrors },
        summary: 'Get one account',
        ...needs('accounts:read'),
      },
      create: {
        method: 'POST',
        path: '/accounts',
        body: createAccountBodySchema,
        responses: { 201: externalAccountSchema, ...errors },
        summary: 'Create an account',
        ...needs('accounts:create'),
      },
      update: {
        method: 'PATCH',
        path: '/accounts/:accountId',
        pathParams: accountPathParams,
        body: updateAccountBodySchema,
        responses: { 200: externalAccountSchema, ...errors },
        summary: 'Update an account',
        ...needs('accounts:update'),
      },
    }),
    categories: c.router({
      list: {
        method: 'GET',
        path: '/categories',
        query: z.object({ type: categoryTypeSchema.optional(), includeArchived: booleanQuerySchema.optional() }),
        responses: { 200: z.array(externalCategorySchema), ...readErrors },
        summary: 'List categories and subcategories, flat; parentId links a subcategory to its category',
        ...needs('categories:read'),
      },
      get: {
        method: 'GET',
        path: '/categories/:categoryId',
        pathParams: categoryPathParams,
        responses: { 200: externalCategorySchema, ...readErrors },
        summary: 'Get one category',
        ...needs('categories:read'),
      },
      create: {
        method: 'POST',
        path: '/categories',
        body: createCategoryBodySchema,
        responses: { 201: externalCategorySchema, ...errors },
        summary: 'Create a category, or a subcategory of one',
        ...needs('categories:create'),
      },
      update: {
        method: 'PATCH',
        path: '/categories/:categoryId',
        pathParams: categoryPathParams,
        body: updateCategoryBodySchema,
        responses: { 200: externalCategorySchema, ...errors },
        summary: 'Rename a category or move it under another',
        ...needs('categories:update'),
      },
    }),
    transactions: c.router({
      list: {
        method: 'GET',
        path: '/transactions',
        query: z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).optional(),
          accountId: z.string().uuid().optional(),
          // A category takes in its subcategories' transactions.
          categoryId: z.string().uuid().optional(),
          type: transactionTypeSchema.optional(),
          dateFrom: dateTimeSchema.optional(),
          dateTo: dateTimeSchema.optional(),
          // Matched against the note, ignoring case.
          search: z.string().optional(),
        }),
        responses: {
          200: z.object({
            items: z.array(externalTransactionSchema),
            // Pass as cursor for the next page; null on the last one.
            nextCursor: z.string().nullable(),
          }),
          ...errors,
        },
        summary: 'List transactions, newest first, a page at a time',
        ...needs('transactions:read'),
      },
      get: {
        method: 'GET',
        path: '/transactions/:transactionId',
        pathParams: transactionPathParams,
        responses: { 200: externalTransactionSchema, ...readErrors },
        summary: 'Get one transaction',
        ...needs('transactions:read'),
      },
      create: {
        method: 'POST',
        path: '/transactions',
        headers: z.object({ 'idempotency-key': idempotencyHeaderSchema.optional() }),
        body: createTransactionBodySchema,
        responses: {
          // A repeat of an earlier request (same idempotency key) is answered like it, with the
          // transaction that request recorded, and an Idempotent-Replayed: true header.
          201: externalTransactionSchema,
          ...errors,
          // The idempotency key was already used for a request asking for something else.
          422: errorSchema,
        },
        summary: 'Record an expense, an income or a transfer; repeats with an idempotency key record it once',
        ...needs('transactions:create'),
      },
      update: {
        method: 'PATCH',
        path: '/transactions/:transactionId',
        pathParams: transactionPathParams,
        body: updateTransactionBodySchema,
        responses: { 200: externalTransactionSchema, ...errors },
        summary: 'Update a transaction',
        ...needs('transactions:update'),
      },
    }),
    notifications: c.router({
      forward: {
        method: 'POST',
        path: '/notifications',
        body: forwardNotificationBodySchema,
        responses: {
          // What the notification recorded. Forwarded again, it records nothing and gets the same
          // transaction, with an Idempotent-Replayed: true header.
          201: externalTransactionSchema,
          200: skippedNotificationSchema,
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          // The text isn't worded the way the bank's notifications are known to be, or no account
          // receives the bank's notifications.
          422: errorSchema,
        },
        summary: "Record what a bank's notification says, read the way that bank words them",
        ...needs('transactions:create'),
      },
    }),
  },
  { pathPrefix: '/api/external/v1' },
);
