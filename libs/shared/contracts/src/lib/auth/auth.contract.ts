import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';

const c = initContract();

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// The fields on their own, so a form can extend them (with a "repeat the new password" field,
// say) without losing the refinement below, which no longer applies once a schema is extended.
export const changePasswordFieldsSchema = z.object({
  // Only that something was typed: what the old password had to satisfy is whatever the rules
  // were when it was set, not today's.
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export const changePasswordSchema = changePasswordFieldsSchema.refine(
  (body) => body.currentPassword !== body.newPassword,
  { message: 'New password must be different from the current one', path: ['newPassword'] },
);

export const authContract = c.router(
  {
    register: {
      method: 'POST',
      path: '/auth/register',
      body: credentialsSchema,
      responses: {
        201: z.object({ user: userSchema, ...authTokensSchema.shape }),
        409: errorSchema,
      },
      summary: 'Register a new account',
    },
    login: {
      method: 'POST',
      path: '/auth/login',
      body: credentialsSchema,
      responses: {
        200: z.object({ user: userSchema, ...authTokensSchema.shape }),
        401: errorSchema,
      },
      summary: 'Authenticate with email and password',
    },
    refresh: {
      method: 'POST',
      path: '/auth/refresh',
      body: z.object({ refreshToken: z.string() }),
      responses: {
        200: authTokensSchema,
        401: errorSchema,
      },
      summary: 'Rotate a refresh token for a new token pair',
    },
    logout: {
      method: 'POST',
      path: '/auth/logout',
      body: z.object({ refreshToken: z.string() }),
      responses: {
        204: z.void(),
      },
      summary: 'Revoke a refresh token',
    },
    changePassword: {
      method: 'POST',
      path: '/auth/password',
      body: changePasswordSchema,
      responses: {
        // A fresh pair for the caller, because changing a password revokes every token issued
        // before it — including the one this request was made with.
        200: authTokensSchema,
        // 403, not 401: the request itself is authenticated, it's the password in the body that
        // is wrong. A 401 here would be indistinguishable from an expired access token.
        403: errorSchema,
      },
      summary: "Change the signed-in user's password and sign every other session out",
    },
  },
  { pathPrefix: '/api' },
);
