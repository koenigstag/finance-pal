import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';
import { moneySchema } from '../common/money.schema.js';
import { timezoneSchema } from '../common/timezone.schema.js';

const c = initContract();

/**
 * What was spent and received on each day of a stretch of time, as the overview charts it. Only what
 * is dated up to now counts: a planned transaction joins in once its day comes, as it does in the
 * balances.
 */
export const overviewDaysSchema = z.object({
  days: z.array(
    z.object({
      // The calendar day in the caller's time zone, YYYY-MM-DD.
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
      type: z.enum(['expense', 'income']),
      // An expense or income by top-level category (a subcategory's count toward its parent). Null,
      // with a null accountId too, for what was filed under none.
      categoryId: z.string().uuid().nullable(),
      // A debt account, for a transfer between it and an account that isn't one. Money into it was
      // lent out or paid back, so it was spent; money out of it was borrowed or paid back to the
      // group, so it was received.
      accountId: z.string().uuid().nullable(),
      // The one the transactions were recorded in; converting is the client's business, at the rates
      // it shows everywhere else.
      currencyId: z.number().int(),
      amount: moneySchema,
    }),
  ),
});

export const overviewContract = c.router(
  {
    days: {
      method: 'GET',
      path: '/groups/:groupId/overview/days',
      pathParams: z.object({ groupId: z.string().uuid() }),
      // The bounds as the transactions list takes them, and the time zone the days are counted in.
      query: z.object({
        dateFrom: z.string().datetime(),
        dateTo: z.string().datetime(),
        timezone: timezoneSchema,
      }),
      responses: { 200: overviewDaysSchema, 400: errorSchema, 404: errorSchema },
      summary: 'What was spent and received each day between two moments, by category and by debt account',
    },
  },
  { pathPrefix: '/api' },
);
