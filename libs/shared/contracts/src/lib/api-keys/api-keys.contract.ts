import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';
import { apiKeyScopeSchema } from './api-key-scopes.js';

const c = initContract();

// A key lets another app — a phone automation, a script — work in one group as the person who
// made it, within its scopes. These routes manage your own keys; the key itself is only ever
// sent to the external API (see external.contract.ts), which is also the only place it works.
export const apiKeySchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  name: z.string(),
  // The first characters of the key, to tell keys apart. The rest is never stored.
  tokenPrefix: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  expiresAt: z.string().datetime().nullable(),
  // To the minute: a key used every few seconds isn't written to on every request.
  lastUsedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

const apiKeyNameSchema = z.string().trim().min(1).max(80);
const apiKeyScopesSchema = z.array(apiKeyScopeSchema).min(1);

const createApiKeyBodySchema = z.object({
  name: apiKeyNameSchema,
  scopes: apiKeyScopesSchema,
  // Must lie ahead; left out, the key works until it's deleted.
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

// Changing what a key may do keeps the key itself, so the app holding it needn't be touched.
const updateApiKeyBodySchema = z.object({
  name: apiKeyNameSchema.optional(),
  scopes: apiKeyScopesSchema.optional(),
});

const groupPathParams = z.object({ groupId: z.string().uuid() });
const apiKeyPathParams = z.object({ groupId: z.string().uuid(), apiKeyId: z.string().uuid() });

export const apiKeysContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups/:groupId/api-keys',
      pathParams: groupPathParams,
      responses: { 200: z.array(apiKeySchema), 404: errorSchema },
      summary: "The caller's own API keys for a group",
    },
    create: {
      method: 'POST',
      path: '/groups/:groupId/api-keys',
      pathParams: groupPathParams,
      body: createApiKeyBodySchema,
      responses: {
        // The only time the key is ever returned: only its hash is kept.
        201: z.object({ apiKey: apiKeySchema, token: z.string() }),
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
      },
      summary: 'Create an API key for a group; the response carries the key itself, once',
    },
    update: {
      method: 'PATCH',
      path: '/groups/:groupId/api-keys/:apiKeyId',
      pathParams: apiKeyPathParams,
      body: updateApiKeyBodySchema,
      responses: { 200: apiKeySchema, 403: errorSchema, 404: errorSchema },
      summary: "Rename an API key or change its scopes; the key itself doesn't change",
    },
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/api-keys/:apiKeyId',
      pathParams: apiKeyPathParams,
      responses: { 200: apiKeySchema, 404: errorSchema },
      summary: 'Delete an API key; it stops working at once',
    },
  },
  { pathPrefix: '/api' },
);
