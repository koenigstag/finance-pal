import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';

const c = initContract();

// One unit of the currency in the key, valued in the base currency. A string, like every other
// amount here, so no float rounding sneaks into a converted total.
export const exchangeRateSchema = z.string().regex(/^\d{1,12}(\.\d{1,8})?$/, 'invalid rate format');
export const exchangeRatesSchema = z.record(z.string().length(3), exchangeRateSchema);

export const exchangeRatesResponseSchema = z.object({
  /** The caller's main currency: every rate says what one unit of another currency costs in it. */
  base: z.string().length(3),
  rates: exchangeRatesSchema,
  /** The day the provider published these, which can trail today — providers refresh once a day. */
  publishedOn: z.string(),
  provider: z.string(),
  /** A credit the provider's terms require on screen wherever its rates are shown. */
  attribution: z.object({ text: z.string(), url: z.string() }).nullable(),
});

export const exchangeRatesContract = c.router(
  {
    get: {
      method: 'GET',
      path: '/exchange-rates',
      responses: { 200: exchangeRatesResponseSchema, 503: errorSchema },
      summary: "Current rates against the caller's main currency, as last fetched from a provider",
    },
  },
  { pathPrefix: '/api' },
);
