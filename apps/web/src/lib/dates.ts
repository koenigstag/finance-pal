import { addMonths, endOfDay, endOfMonth, format, isSameDay, isValid, parse, set, startOfMonth } from 'date-fns';

// A calendar day as <input type="date"> reads and writes it, in the user's local time zone.
const DAY_FORMAT = 'yyyy-MM-dd';
const MONTH_FORMAT = 'yyyy-MM';

export function toDayInput(iso: string): string {
  return format(new Date(iso), DAY_FORMAT);
}

export function todayInput(now = new Date()): string {
  return format(now, DAY_FORMAT);
}

/**
 * The instant to store for a transaction the user dated `day`. The form only picks a day, but
 * the API keeps a timestamp, lists by it newest first, and treats anything after "now" as planned:
 * - the day it already had keeps its original time, so an edit elsewhere doesn't reorder it;
 * - today is "now", so a new entry counts toward the balance immediately and sorts on top;
 * - a day gone by is its very end, so an entry added to it late sorts on top of that day too,
 *   after everything recorded on it, rather than somewhere in among it;
 * - a day still to come is local noon, safely inside that day whatever the offset to UTC.
 */
export function fromDayInput(day: string, previousIso?: string, now = new Date()): string {
  // Today is settled before this is asked, so a day starting before now has gone by.
  return instantOnDay(day, previousIso, now, (date) => (date < now ? endOfDay(date) : noon(date)));
}

/**
 * The instant a series starts at, for the first date the user picked, `day`. Its time of day is
 * the one each of its transactions comes at, so any day but today is local noon, gone by or still
 * to come: at a day's very end, each would stay planned all through its day. Otherwise as
 * fromDayInput: the day it already had keeps its time, and today is "now".
 */
export function seriesStartFromDayInput(day: string, previousIso?: string, now = new Date()): string {
  return instantOnDay(day, previousIso, now, noon);
}

function instantOnDay(day: string, previousIso: string | undefined, now: Date, otherDay: (date: Date) => Date): string {
  const date = parse(day, DAY_FORMAT, now);
  if (previousIso && isSameDay(new Date(previousIso), date)) {
    return previousIso;
  }
  if (isSameDay(date, now)) {
    return now.toISOString();
  }
  return otherDay(date).toISOString();
}

function noon(date: Date): Date {
  return set(date, { hours: 12, minutes: 0, seconds: 0, milliseconds: 0 });
}

/** The device's IANA time zone, e.g. "Europe/Kyiv": the one a new series keeps its dates in. */
export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "2026-09" for a month filter in the URL. */
export function toMonthParam(date: Date): string {
  return format(date, MONTH_FORMAT);
}

/** The month a URL parameter names, or the current one if it's missing or malformed. */
export function parseMonthParam(param: string | null, now = new Date()): Date {
  const parsed = param ? parse(param, MONTH_FORMAT, now) : null;
  return parsed && isValid(parsed) ? startOfMonth(parsed) : startOfMonth(now);
}

export function shiftMonth(month: Date, delta: number): Date {
  return startOfMonth(addMonths(month, delta));
}

/** Inclusive bounds of a local calendar month, as the transactions list filter expects. */
export function monthRange(month: Date): { dateFrom: string; dateTo: string } {
  return { dateFrom: startOfMonth(month).toISOString(), dateTo: endOfMonth(month).toISOString() };
}
