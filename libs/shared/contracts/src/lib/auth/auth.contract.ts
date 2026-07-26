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
  },
  { pathPrefix: '/api' },
);
