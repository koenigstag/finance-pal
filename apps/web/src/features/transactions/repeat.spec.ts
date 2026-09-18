import { describe, expect, it } from 'vitest';
import { REPEAT_PRESETS, parseRepeatKey, repeatChoices, toRepeatKey } from './repeat';

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
