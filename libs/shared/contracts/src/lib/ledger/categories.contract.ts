import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { booleanQuerySchema } from '../common/boolean-query.schema.js';
import { errorSchema } from '../common/error.schema.js';

const c = initContract();

export const CATEGORY_TYPES = ['income', 'expense'] as const;
export const categoryTypeSchema = z.enum(CATEGORY_TYPES);

export const categorySchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  type: categoryTypeSchema,
  name: z.string().min(1).max(120),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number().int(),
  archived: z.boolean(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const createCategoryBodySchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  type: categoryTypeSchema,
  name: z.string().min(1).max(120),
  // A name from the client's icon set (e.g. "shopping-cart"); null clears it.
  icon: z.string().min(1).max(40).nullable().optional(),
  // #RRGGBB; null clears it.
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be #RRGGBB')
    .nullable()
    .optional(),
  sortOrder: z.number().int().optional(),
});

// The type is fixed once a category exists: its subcategories, transactions and recurring rules
// were all filed under that type.
const updateCategoryBodySchema = createCategoryBodySchema.omit({ type: true }).partial();

// A whole level at a time, rather than one category's new place: the client already holds the
// list it is showing, and sending it back whole is what makes the result the same however many
// rows moved — no gaps, no ties, and nothing to reconcile against an order the server had.
const reorderCategoriesBodySchema = z.object({
  // The categories to renumber, in the order they are to appear. Siblings take their place from
  // this list; where a category sits — its type, its parent — is left alone, which is what update
  // is for. Ids of another group's categories, or repeated ones, are refused.
  categoryIds: z.array(z.string().uuid()).min(1).max(500),
});

// What deleting a category takes with it, for the confirmation shown before doing so.
export const categoryUsageSchema = z.object({
  // Subcategories, deleted along with it.
  subcategoryCount: z.number().int(),
  // Transactions filed under it or its subcategories that already happened. They're kept: a
  // category's become uncategorized, a subcategory's stay in its parent without a subcategory.
  transactionCount: z.number().int(),
  // Future-dated ones, mostly occurrences recurring rules scheduled ahead.
  plannedTransactionCount: z.number().int(),
  // Recurring rules using it or its subcategories; also kept, without a category.
  recurringRuleCount: z.number().int(),
  // Category rules filing into it or its subcategories: deleted along with it, having nowhere left
  // to file.
  categoryRuleCount: z.number().int(),
});

const groupPathParams = z.object({ groupId: z.string().uuid() });
const categoryPathParams = z.object({ groupId: z.string().uuid(), categoryId: z.string().uuid() });

export const categoriesContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups/:groupId/categories',
      pathParams: groupPathParams,
      query: z.object({ includeArchived: booleanQuerySchema.optional() }),
      responses: { 200: z.array(categorySchema), 404: errorSchema },
      summary: 'List categories in a group, flat (parentId forms the tree, client builds it)',
    },
    create: {
      method: 'POST',
      path: '/groups/:groupId/categories',
      pathParams: groupPathParams,
      body: createCategoryBodySchema,
      responses: { 201: categorySchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Create a category in a group',
    },
    get: {
      method: 'GET',
      path: '/groups/:groupId/categories/:categoryId',
      pathParams: categoryPathParams,
      responses: { 200: categorySchema, 404: errorSchema },
      summary: 'Get one category',
    },
    update: {
      method: 'PATCH',
      path: '/groups/:groupId/categories/:categoryId',
      pathParams: categoryPathParams,
      body: updateCategoryBodySchema,
      responses: { 200: categorySchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Update a category',
    },
    archive: {
      method: 'POST',
      path: '/groups/:groupId/categories/:categoryId/archive',
      pathParams: categoryPathParams,
      body: z.object({}),
      responses: { 200: categorySchema, 403: errorSchema, 404: errorSchema },
      summary: 'Archive a category',
    },
    restore: {
      method: 'POST',
      path: '/groups/:groupId/categories/:categoryId/restore',
      pathParams: categoryPathParams,
      body: z.object({}),
      responses: { 200: categorySchema, 403: errorSchema, 404: errorSchema },
      summary: 'Restore an archived category',
    },
    reorder: {
      method: 'POST',
      path: '/groups/:groupId/categories/reorder',
      pathParams: groupPathParams,
      body: reorderCategoriesBodySchema,
      responses: { 200: z.array(categorySchema), 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Renumber categories: each one takes its place among its siblings from the order given',
    },
    usage: {
      method: 'GET',
      path: '/groups/:groupId/categories/:categoryId/usage',
      pathParams: categoryPathParams,
      responses: { 200: categoryUsageSchema, 404: errorSchema },
      summary: 'Count what deleting the category would affect: subcategories, transactions, recurring rules',
    },
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/categories/:categoryId',
      pathParams: categoryPathParams,
      responses: { 200: categorySchema, 403: errorSchema, 404: errorSchema },
      summary:
        'Delete a category with its subcategories; what used a category becomes uncategorized, what used a subcategory keeps its parent',
    },
  },
  { pathPrefix: '/api' },
);
