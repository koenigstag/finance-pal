import { describe, expect, it } from 'vitest';
import { detectStartDayOfWeek, weekdayNames } from './week';

describe('weekdayNames', () => {
  it('indexes names from Sunday, like Date.getDay()', () => {
    const names = weekdayNames('en-US');
    expect(names[0]).toBe('Sunday');
    expect(names[1]).toBe('Monday');
    expect(names[6]).toBe('Saturday');
  });

  it('capitalizes locales that write weekdays in lowercase', () => {
    expect(weekdayNames('ru')[1]).toBe('Понедельник');
  });
});

describe('detectStartDayOfWeek', () => {
  it('uses the locale convention', () => {
    expect(detectStartDayOfWeek('en-US')).toBe(0);
    expect(detectStartDayOfWeek('ru-RU')).toBe(1);
  });

  it('falls back to Monday for an invalid tag', () => {
    expect(detectStartDayOfWeek('not a locale')).toBe(1);
  });
});
