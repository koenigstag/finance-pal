import { describe, expect, it } from 'vitest';
import { defaultSchedule, formatScheduledAt, toInstant } from './scheduled';

describe('toInstant', () => {
  it('reads the date and time as the device means them', () => {
    const instant = toInstant('2026-10-14', '09:00');

    // Whatever zone these tests run in, that is the moment 09:00 named there.
    expect(instant).toBe(new Date(2026, 9, 14, 9, 0).toISOString());
  });

  it('has nothing to schedule without both halves', () => {
    expect(toInstant('', '09:00')).toBeNull();
    expect(toInstant('2026-10-14', '')).toBeNull();
  });

  it('refuses a date the browser cannot read', () => {
    expect(toInstant('not-a-date', '09:00')).toBeNull();
  });
});

describe('formatScheduledAt', () => {
  it("shows the time in the zone it was picked in, not the reader's", () => {
    // 09:00 in Kyiv (UTC+3 in October).
    const formatted = formatScheduledAt('2026-10-14T06:00:00.000Z', 'Europe/Kyiv', 'en-GB');

    expect(formatted).toMatch(/09:00/);
  });

  it('falls back to the device zone for one it does not know', () => {
    expect(formatScheduledAt('2026-10-14T06:00:00.000Z', 'Mars/Olympus', 'en-GB')).toMatch(/2026/);
  });
});

describe('defaultSchedule', () => {
  it('starts on tomorrow morning', () => {
    expect(defaultSchedule(new Date(2026, 9, 14, 23, 30))).toEqual({ date: '2026-10-15', time: '09:00' });
  });

  it('carries into the next month', () => {
    expect(defaultSchedule(new Date(2026, 9, 31, 8, 0)).date).toBe('2026-11-01');
  });
});
