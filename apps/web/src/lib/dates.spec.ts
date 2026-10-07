import { describe, expect, it } from 'vitest';
import {
  fromDayInput,
  monthRange,
  parseMonthParam,
  seriesStartFromDayInput,
  shiftMonth,
  toDayInput,
  toMonthParam,
} from './dates';

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

  it('uses the very end of a day gone by, so what is added to it late sorts on top of it', () => {
    expect(fromDayInput('2026-09-16', undefined, now)).toBe(new Date(2026, 8, 16, 23, 59, 59, 999).toISOString());
    // Moved there from another day, too.
    const previous = new Date(2026, 8, 3, 8, 15).toISOString();
    expect(fromDayInput('2026-09-04', previous, now)).toBe(new Date(2026, 8, 4, 23, 59, 59, 999).toISOString());
  });

  it('uses local noon for a day still to come', () => {
    expect(fromDayInput('2026-10-01', undefined, now)).toBe(new Date(2026, 9, 1, 12).toISOString());
    const previous = new Date(2026, 8, 3, 8, 15).toISOString();
    expect(fromDayInput('2026-09-18', previous, now)).toBe(new Date(2026, 8, 18, 12).toISOString());
  });

  it('round-trips through toDayInput', () => {
    expect(toDayInput(fromDayInput('2026-12-31', undefined, now))).toBe('2026-12-31');
    expect(toDayInput(fromDayInput('2026-01-31', undefined, now))).toBe('2026-01-31');
  });
});

describe('seriesStartFromDayInput', () => {
  it('starts at local noon on any day but today, gone by or still to come', () => {
    expect(seriesStartFromDayInput('2026-09-16', undefined, now)).toBe(new Date(2026, 8, 16, 12).toISOString());
    expect(seriesStartFromDayInput('2026-10-01', undefined, now)).toBe(new Date(2026, 9, 1, 12).toISOString());
  });

  it('starts today right now, and keeps the time of the day it already had', () => {
    expect(seriesStartFromDayInput('2026-09-17', undefined, now)).toBe(now.toISOString());
    const previous = new Date(2026, 8, 3, 8, 15).toISOString();
    expect(seriesStartFromDayInput('2026-09-03', previous, now)).toBe(previous);
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
