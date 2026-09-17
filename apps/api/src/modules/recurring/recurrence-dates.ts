import { TZDate } from '@date-fns/tz';
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarYears,
  endOfMonth,
  startOfDay,
} from 'date-fns';
import type { RECURRENCE_UNITS } from '@ft/shared-contracts';

// The wire union rather than api-database's RecurrenceUnit enum, imported as a type only: the
// enum's string members are assignable to it, and this keeps the module free of any runtime
// dependency beyond date-fns — importing @ft/api-database would build a DataSource as a side
// effect, which a pure date helper (and its unit tests) has no business doing.
type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export interface Schedule {
  startsAt: Date;
  intervalUnit: RecurrenceUnit;
  intervalValue: number;
  timezone: string;
}

// All arithmetic runs on TZDate so that "one month later" and "start of day" mean what they mean
// on a calendar in the rule's zone (month-end clamping, DST keeping the wall-clock time), and
// every result is handed back as a plain Date — an instant, which is all Postgres stores.

function add(date: TZDate, unit: RecurrenceUnit, amount: number): TZDate {
  switch (unit) {
    case 'day':
      return addDays(date, amount);
    case 'week':
      return addWeeks(date, amount);
    case 'month':
      return addMonths(date, amount);
    case 'year':
      return addYears(date, amount);
  }
}

function elapsedUnits(from: TZDate, to: TZDate, unit: RecurrenceUnit): number {
  switch (unit) {
    case 'day':
      return differenceInCalendarDays(to, from);
    case 'week':
      return Math.floor(differenceInCalendarDays(to, from) / 7);
    case 'month':
      return differenceInCalendarMonths(to, from);
    case 'year':
      return differenceInCalendarYears(to, from);
  }
}

/**
 * Occurrence k of the series (k = 0 is startsAt). Always computed from the anchor, never by
 * stepping from the previous occurrence: stepping drifts on month ends and never recovers
 * (Jan 31 → Feb 28 → Mar 28), anchoring doesn't (Jan 31 → Feb 28 → Mar 31).
 */
export function occurrenceAt(schedule: Schedule, k: number): Date {
  const anchor = new TZDate(schedule.startsAt, schedule.timezone);
  return new Date(add(anchor, schedule.intervalUnit, k * schedule.intervalValue).getTime());
}

/** Index of the first occurrence at or after `bound`. */
export function firstIndexAtOrAfter(schedule: Schedule, bound: Date): number {
  if (bound.getTime() <= schedule.startsAt.getTime()) {
    return 0;
  }
  const anchor = new TZDate(schedule.startsAt, schedule.timezone);
  const zonedBound = new TZDate(bound, schedule.timezone);
  let k = Math.max(0, Math.floor(elapsedUnits(anchor, zonedBound, schedule.intervalUnit) / schedule.intervalValue));
  // The calendar-difference estimate can be one off (a clamped month end, a time of day later
  // than the bound's), so settle on the exact index from there.
  while (k > 0 && occurrenceAt(schedule, k - 1).getTime() >= bound.getTime()) {
    k--;
  }
  while (occurrenceAt(schedule, k).getTime() < bound.getTime()) {
    k++;
  }
  return k;
}

/** Last instant occurrences are materialized up to: the end of next calendar month, in the zone. */
export function horizonEnd(now: Date, timezone: string): Date {
  return new Date(endOfMonth(addMonths(new TZDate(now, timezone), 1)).getTime());
}

/**
 * Occurrences before this are skipped, not backfilled. Start of today rather than `now`, so a
 * rule created this afternoon with today's date still gets today's occurrence.
 */
export function gapCutoff(now: Date, timezone: string): Date {
  return new Date(startOfDay(new TZDate(now, timezone)).getTime());
}
