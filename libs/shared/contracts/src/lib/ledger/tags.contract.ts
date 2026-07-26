import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';

const c = initContract();

export const tagSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  name: z.string().min(1).max(60),
  createdAt: z.string().datetime(),
});

const groupPathParams = z.object({ groupId: z.string().uuid() });
const tagPathParams = z.object({ groupId: z.string().uuid(), tagId: z.string().uuid() });

export const tagsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups/:groupId/tags',
      pathParams: groupPathParams,
      responses: { 200: z.array(tagSchema), 404: errorSchema },
      summary: 'List tags in a group',
    },
    create: {
      method: 'POST',
      path: '/groups/:groupId/tags',
      pathParams: groupPathParams,
      body: z.object({ name: z.string().min(1).max(60) }),
      responses: { 201: tagSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema },
      summary: 'Create a tag in a group (name unique per group)',
    },
    rename: {
      method: 'PATCH',
      path: '/groups/:groupId/tags/:tagId',
      pathParams: tagPathParams,
      body: z.object({ name: z.string().min(1).max(60) }),
      responses: { 200: tagSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema },
      summary: 'Rename a tag',
    },
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/tags/:tagId',
      pathParams: tagPathParams,
      responses: { 200: tagSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Delete a tag (hard delete — cascades to transaction_tags)',
    },
  },
  { pathPrefix: '/api' },
);
