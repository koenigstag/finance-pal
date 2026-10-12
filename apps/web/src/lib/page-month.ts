import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useStores } from '@/stores/stores-context';
import { parseMonthParam, shiftMonth, toMonthParam } from './dates';

/**
 * The month a page that goes a month at a time is on, and a step to the one before or after.
 *
 * The URL's `month` says which, so a reload or the back button keeps it. A link without one — a tab,
 * "show transactions" from an account — opens on the month the last such page was on, and every
 * month shown becomes that one in turn, so the transactions, budget and overview move together.
 */
export function usePageMonth() {
  const { month: shared } = useStores();
  const [params, setParams] = useSearchParams();
  const monthKey = toMonthParam(parseMonthParam(params.get('month') ?? shared.month));
  const month = useMemo(() => parseMonthParam(monthKey), [monthKey]);

  useEffect(() => {
    shared.setMonth(monthKey);
  }, [shared, monthKey]);

  // Replaces the entry rather than adding one: going back leaves the page, not the month.
  const goToMonth = (delta: number) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('month', toMonthParam(shiftMonth(month, delta)));
        return next;
      },
      { replace: true },
    );

  return { month, monthKey, goToMonth };
}

/** The query for a link to one of those pages: on the shared month, or none for the current one. */
export function monthSearch(month: string | null, now = new Date()): string {
  return month && month !== toMonthParam(now) ? `?month=${month}` : '';
}
