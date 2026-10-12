import { TZDate } from '@date-fns/tz';
import { format } from 'date-fns';
import { sumMoney, type overviewDaysSchema } from '@ft/shared-contracts';
import type { z } from 'zod';

export type OverviewDayTotal = z.infer<typeof overviewDaysSchema>['days'][number];

/** One transaction's money as the overview counts it: spent or received, and what on. */
export interface MoneyMoved {
  date: Date;
  type: 'expense' | 'income';
  categoryId: string | null;
  accountId: string | null;
  currencyId: number;
  amount: string;
}

/**
 * Money added up by the calendar day it fell on in `timezone`, and by what it went on, in each
 * currency it was recorded in. Ordered by day, then type, so a response reads the same every time.
 *
 * Done here rather than in SQL: Postgres knows time zones by its own list, which needn't hold every
 * name the API accepts, while this counts days by the same Intl that validated the name.
 */
export function totalByDay(rows: MoneyMoved[], timezone: string): OverviewDayTotal[] {
  const groups = new Map<string, { total: Omit<OverviewDayTotal, 'amount'>; amounts: string[] }>();
  for (const row of rows) {
    const day = format(new TZDate(row.date, timezone), 'yyyy-MM-dd');
    const key = [day, row.type, row.categoryId ?? '', row.accountId ?? '', row.currencyId].join('|');
    const group = groups.get(key);
    if (group) {
      group.amounts.push(row.amount);
    } else {
      groups.set(key, {
        total: { day, type: row.type, categoryId: row.categoryId, accountId: row.accountId, currencyId: row.currencyId },
        amounts: [row.amount],
      });
    }
  }
  return (
    [...groups.values()]
      .map(({ total, amounts }) => ({ ...total, amount: sumMoney(amounts) }))
      // An estimate can still stand at nothing: there is no money to show for it.
      .filter((total) => /[1-9]/.test(total.amount))
      .sort((a, b) => a.day.localeCompare(b.day) || a.type.localeCompare(b.type))
  );
}
