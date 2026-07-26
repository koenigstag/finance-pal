import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { MEMBER_ROLES } from '../authz/ability.js';

const c = initContract();

export const groupSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  ownerId: z.string().uuid(),
  archivedAt: z.string().datetime().nullable(),
  role: z.enum(MEMBER_ROLES),
});

const errorSchema = z.object({
  statusCode: z.number(),
  message: z.string(),
});

export const groupsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups',
      responses: { 200: z.array(groupSchema) },
      summary: 'List groups the caller belongs to',
    },
    create: {
      method: 'POST',
      path: '/groups',
      body: z.object({ name: z.string().min(1).max(120) }),
      responses: { 201: groupSchema },
      summary: 'Create a group, with the caller as its owner',
    },
    rename: {
      method: 'PATCH',
      path: '/groups/:groupId',
      pathParams: z.object({ groupId: z.string().uuid() }),
      body: z.object({ name: z.string().min(1).max(120) }),
      responses: {
        200: groupSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: 'Rename a group (owner only)',
    },
    archive: {
      method: 'POST',
      path: '/groups/:groupId/archive',
      pathParams: z.object({ groupId: z.string().uuid() }),
      body: z.object({}),
      responses: {
        200: groupSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: 'Archive a group, making it read-only (owner only)',
    },
    restore: {
      method: 'POST',
      path: '/groups/:groupId/restore',
      pathParams: z.object({ groupId: z.string().uuid() }),
      body: z.object({}),
      responses: {
        200: groupSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: 'Restore an archived group (owner only)',
    },
  },
  { pathPrefix: '/api' },
);
