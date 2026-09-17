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
  icon: z.string().optional(),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
});

const updateCategoryBodySchema = createCategoryBodySchema.partial();

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
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/categories/:categoryId',
      pathParams: categoryPathParams,
      responses: { 200: categorySchema, 403: errorSchema, 404: errorSchema },
      summary: 'Soft-delete a category',
    },
  },
  { pathPrefix: '/api' },
);
