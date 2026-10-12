import { TZDate } from '@date-fns/tz';
import { endOfDay, endOfMonth, format } from 'date-fns';

/** A request an assistant made that can't be read, said so it can ask again. */
export class ToolInputError extends Error {}

export interface Period {
  // Inclusive bounds, as the ledger's filters take them.
  from: Date;
  to: Date;
  // The first and last calendar day, YYYY-MM-DD, in the time zone the period was read in.
  firstDay: string;
  lastDay: string;
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The month "YYYY-MM" as a period, in the time zone. */
export function monthPeriod(month: string, timeZone: string): Period {
  const match = MONTH_PATTERN.exec(month);
  if (!match) {
    throw new ToolInputError(`"${month}" isn't a month: expected YYYY-MM, like 2026-10`);
  }
  const start = new TZDate(Number(match[1]), Number(match[2]) - 1, 1, timeZone);
  return periodBetween(start, endOfMonth(start), timeZone);
}

/**
 * One end of a period, given as a calendar day (YYYY-MM-DD: its start or its end in the time zone)
 * or as an exact moment with an offset.
 */
export function readBound(value: string, timeZone: string, edge: 'start' | 'end'): Date {
  const day = DAY_PATTERN.exec(value);
  if (day) {
    const start = new TZDate(Number(day[1]), Number(day[2]) - 1, Number(day[3]), timeZone);
    // TZDate rolls an impossible date over (2026-02-30 → March 2nd); a day that isn't one is refused.
    if (format(start, 'yyyy-MM-dd') !== value) {
      throw new ToolInputError(`"${value}" isn't a date`);
    }
    return new Date((edge === 'start' ? start : endOfDay(start)).getTime());
  }
  // Only with an offset: a bare "2026-10-03T10:00" would be read in whatever zone the server is in.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const moment = new Date(value);
    if (!Number.isNaN(moment.getTime())) {
      return moment;
    }
  }
  throw new ToolInputError(`"${value}" isn't a date: expected YYYY-MM-DD, or a date and time with an offset`);
}

/** Both bounds, read as readBound reads them, in order. */
export function rangePeriod(from: string, to: string, timeZone: string): Period {
  const start = readBound(from, timeZone, 'start');
  const end = readBound(to, timeZone, 'end');
  if (start > end) {
    throw new ToolInputError(`${from} comes after ${to}`);
  }
  return periodBetween(new TZDate(start, timeZone), new TZDate(end, timeZone), timeZone);
}

function periodBetween(start: Date, end: Date, timeZone: string): Period {
  return {
    from: new Date(start.getTime()),
    to: new Date(end.getTime()),
    firstDay: localDay(start, timeZone),
    lastDay: localDay(end, timeZone),
  };
}

/** How many of the period's calendar days have come by `now`, today's included. */
export function daysCounted(period: Period, now: Date, timeZone: string): number {
  if (now < period.from) {
    return 0;
  }
  const last = now > period.to ? period.lastDay : localDay(now, timeZone);
  return dayNumber(last) - dayNumber(period.firstDay) + 1;
}

export function currentMonth(now: Date, timeZone: string): string {
  return format(new TZDate(now, timeZone), 'yyyy-MM');
}

export function localDay(moment: Date, timeZone: string): string {
  return format(new TZDate(moment, timeZone), 'yyyy-MM-dd');
}

/** A moment as the person reads it: their date and time, with the offset that makes it exact. */
export function localDateTime(moment: Date, timeZone: string): string {
  return format(new TZDate(moment, timeZone), "yyyy-MM-dd'T'HH:mmXXX");
}

// Days since the epoch, for counting the days between two calendar days.
function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date) / 86_400_000;
}
