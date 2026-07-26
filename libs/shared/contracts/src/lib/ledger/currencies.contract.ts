import { initContract } from '@ts-rest/core';
import { z } from 'zod';

const c = initContract();

export const currencySchema = z.object({
  id: z.number().int(),
  code: z.string(),
  name: z.string(),
  symbol: z.string().nullable(),
});

export const currenciesContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/currencies',
      responses: { 200: z.array(currencySchema) },
      summary: 'List all currencies (global reference data, not group-scoped)',
    },
  },
  { pathPrefix: '/api' },
);
