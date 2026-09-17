import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';

const c = initContract();

// Keep in sync with ONBOARDING_REQUIRED_FIELDS in apps/api's onboarding module — these are the
// two fields whose absence flips isOnboarded back to false, for new registrations and for
// existing profiles alike whenever a new one is added.
export const profileSchema = z.object({
  displayName: z.string().min(1).max(80).nullable(),
  startDayOfWeek: z.number().int().min(0).max(6).nullable(),
  mainCurrencyId: z.number().int(),
  language: z.string(),
});

export const onboardingStatusSchema = z.object({
  isOnboarded: z.boolean(),
  missingFields: z.array(z.string()),
});

const updateProfileBodySchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  startDayOfWeek: z.number().int().min(0).max(6).optional(),
  mainCurrencyId: z.number().int().optional(),
  language: z.string().optional(),
});

export const onboardingContract = c.router(
  {
    status: {
      method: 'GET',
      path: '/onboarding/status',
      responses: { 200: onboardingStatusSchema },
      summary: 'Whether the caller has completed onboarding, and which fields are still missing',
    },
    getProfile: {
      method: 'GET',
      path: '/onboarding/profile',
      responses: { 200: profileSchema, 404: errorSchema },
      summary: "The caller's profile; 404 until the first updateProfile creates it",
    },
    updateProfile: {
      method: 'PATCH',
      path: '/onboarding/profile',
      body: updateProfileBodySchema,
      responses: { 200: profileSchema },
      summary: 'Create or partially update the caller\'s profile — same endpoint for first-time onboarding and filling in fields added later',
    },
  },
  { pathPrefix: '/api' },
);
