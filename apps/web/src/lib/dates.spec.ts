import { describe, expect, it } from 'vitest';
import { fromDayInput, monthRange, parseMonthParam, shiftMonth, toDayInput, toMonthParam } from './dates';

// Local-time constructors throughout: these helpers are about the user's calendar, not UTC.
const now = new Date(2026, 8, 17, 15, 30);

describe('fromDayInput', () => {
  it('keeps the original timestamp when the day did not change', () => {
    const previous = new Date(2026, 8, 3, 8, 15).toISOString();
    expect(fromDayInput('2026-09-03', previous, now)).toBe(previous);
  });

  it('uses the current instant for today', () => {
    expect(fromDayInput('2026-09-17', undefined, now)).toBe(now.toISOString());
  });

  it('uses local noon for any other day', () => {
    expect(fromDayInput('2026-10-01', undefined, now)).toBe(new Date(2026, 9, 1, 12).toISOString());
    const previous = new Date(2026, 8, 3, 8, 15).toISOString();
    expect(fromDayInput('2026-09-04', previous, now)).toBe(new Date(2026, 8, 4, 12).toISOString());
  });

  it('round-trips through toDayInput', () => {
    expect(toDayInput(fromDayInput('2026-12-31', undefined, now))).toBe('2026-12-31');
  });
});

describe('month params', () => {
  it('parses a valid month and falls back to the current one', () => {
    expect(parseMonthParam('2026-02', now)).toEqual(new Date(2026, 1, 1));
    expect(parseMonthParam('garbage', now)).toEqual(new Date(2026, 8, 1));
    expect(parseMonthParam(null, now)).toEqual(new Date(2026, 8, 1));
  });

  it('shifts across year boundaries', () => {
    expect(toMonthParam(shiftMonth(new Date(2026, 11, 1), 1))).toBe('2027-01');
    expect(toMonthParam(shiftMonth(new Date(2026, 0, 1), -1))).toBe('2025-12');
  });

  it('covers the whole local month inclusively', () => {
    const { dateFrom, dateTo } = monthRange(new Date(2026, 1, 1));
    expect(dateFrom).toBe(new Date(2026, 1, 1).toISOString());
    expect(dateTo).toBe(new Date(2026, 1, 28, 23, 59, 59, 999).toISOString());
  });
});
