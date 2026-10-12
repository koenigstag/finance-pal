import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { apiKeyScopeSchema } from '../api-keys/api-key-scopes.js';
import { errorSchema } from '../common/error.schema.js';
import { timezoneSchema } from '../common/timezone.schema.js';

const c = initContract();

/**
 * An app asking to connect to a group through OAuth sign-in, as an AI assistant does to reach the
 * MCP endpoint: the authorization request the app sent the person's browser with. The API's own
 * /api/oauth/authorize checks it and hands it on to the app's consent page, which passes it back
 * here word for word, so the parameters keep the names OAuth gives them.
 *
 * Only the shape is checked here. What makes a request good — a client the API registered, the
 * redirect it registered, PKCE — is the API's to judge, and both routes below judge it again.
 */
export const oauthAuthorizationRequestSchema = z.object({
  response_type: z.string().max(100).optional(),
  client_id: z.string().max(4000),
  redirect_uri: z.string().max(2000).optional(),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  state: z.string().max(2000).optional(),
  scope: z.string().max(2000).optional(),
  resource: z.string().max(2000).optional(),
});

export const oauthConsentSchema = z.object({
  // As the app named itself when it registered. Anyone can register any name, so it's no proof of
  // who the app is; the page shows it beside where the app is sent back to.
  clientName: z.string(),
  // Where allowing sends the person, and the app's code with them: the host is what identifies the app.
  redirectHost: z.string(),
  // What the app gets to see. It is never given more than viewing.
  scopes: z.array(apiKeyScopeSchema),
  // Where Cancel goes: back to the app, telling it the person said no.
  denyUrl: z.string(),
});

const approveBodySchema = oauthAuthorizationRequestSchema.extend({
  // The group the app may see: one, as with any API key.
  groupId: z.string().uuid(),
  // The person's own, from their browser: where the app's reports count their days.
  timeZone: timezoneSchema.optional(),
});

export const oauthContract = c.router(
  {
    describe: {
      method: 'GET',
      path: '/oauth/consent',
      query: oauthAuthorizationRequestSchema,
      responses: { 200: oauthConsentSchema, 400: errorSchema, 503: errorSchema },
      summary: 'What an app asking to connect would get, for the consent page to show',
    },
    approve: {
      method: 'POST',
      path: '/oauth/consent',
      body: approveBodySchema,
      responses: {
        // Where to send the browser: back to the app, with a code it trades for read-only access.
        200: z.object({ redirectTo: z.string() }),
        400: errorSchema,
        403: errorSchema,
        404: errorSchema,
        503: errorSchema,
      },
      summary: 'Let an app see one group, read-only; the response says where to send the browser',
    },
  },
  { pathPrefix: '/api' },
);
