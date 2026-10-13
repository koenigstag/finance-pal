import { describe, expect, it } from 'vitest';
import { REPEAT_PRESETS, lastPaymentDay, parseRepeatKey, repeatChoices, toRepeatKey } from './repeat';

describe('repeat keys', () => {
  it('round-trip every preset', () => {
    for (const preset of REPEAT_PRESETS) {
      expect(parseRepeatKey(toRepeatKey(preset))).toEqual(preset);
    }
  });

  it("read '' and anything malformed as no repeat", () => {
    expect(toRepeatKey(null)).toBe('');
    expect(parseRepeatKey('')).toBeNull();
    expect(parseRepeatKey('fortnight:1')).toBeNull();
    expect(parseRepeatKey('week:0')).toBeNull();
    expect(parseRepeatKey('week:1.5')).toBeNull();
  });
});

describe('repeatChoices', () => {
  it('offers the presets, in 1Money order', () => {
    expect(repeatChoices(null).map(toRepeatKey)).toEqual([
      'day:1',
      'day:2',
      'week:1',
      'week:2',
      'week:4',
      'month:1',
      'month:2',
      'month:3',
      'month:6',
      'year:1',
    ]);
  });

  it("adds a series' own repeat when it's none of them", () => {
    expect(repeatChoices({ unit: 'month', value: 1 })).toBe(REPEAT_PRESETS);
    expect(repeatChoices({ unit: 'day', value: 5 }).at(-1)).toEqual({ unit: 'day', value: 5 });
  });
});

describe('lastPaymentDay', () => {
  const monthly = { unit: 'month', value: 1 } as const;

  it('counts the payments from the first on or after the day given', () => {
    // Twelve from 20 October: the last comes the next September.
    expect(lastPaymentDay('2026-10-20', monthly, '2026-10-20', 12)).toBe('2027-09-20');
    expect(lastPaymentDay('2026-01-20', monthly, '2026-10-21', 2)).toBe('2026-12-20');
    expect(lastPaymentDay('2026-10-20', monthly, '2026-10-20', 1)).toBe('2026-10-20');
  });

  it('keeps to the day the series began on after a short month, as the API does', () => {
    expect(lastPaymentDay('2026-01-31', monthly, '2026-02-01', 2)).toBe('2026-03-31');
    expect(lastPaymentDay('2026-01-31', monthly, '2026-02-01', 1)).toBe('2026-02-28');
  });

  it('steps by the repeat it has', () => {
    expect(lastPaymentDay('2026-10-01', { unit: 'week', value: 2 }, '2026-10-01', 3)).toBe('2026-10-29');
    expect(lastPaymentDay('2026-10-01', { unit: 'day', value: 1 }, '2026-10-01', 10)).toBe('2026-10-10');
    expect(lastPaymentDay('2024-02-29', { unit: 'year', value: 1 }, '2024-03-01', 1)).toBe('2025-02-28');
  });
});
