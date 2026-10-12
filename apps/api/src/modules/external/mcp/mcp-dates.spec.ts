import { ToolInputError, currentMonth, daysCounted, localDateTime, monthPeriod, rangePeriod, readBound } from './mcp-dates';

const KYIV = 'Europe/Kyiv';

describe('monthPeriod', () => {
  it('runs from the first moment of the month to the last, in the time zone', () => {
    const period = monthPeriod('2026-10', KYIV);
    // Kyiv is UTC+3 until October 25th, UTC+2 after it.
    expect(period.from.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(period.to.toISOString()).toBe('2026-10-31T21:59:59.999Z');
    expect(period).toMatchObject({ firstDay: '2026-10-01', lastDay: '2026-10-31' });
  });

  it('knows February', () => {
    expect(monthPeriod('2028-02', 'UTC').lastDay).toBe('2028-02-29');
  });

  it.each(['2026-13', '2026-1', 'October'])('refuses %j', (month) => {
    expect(() => monthPeriod(month, KYIV)).toThrow(ToolInputError);
  });
});

describe('readBound', () => {
  it('takes a day as its start or its end', () => {
    expect(readBound('2026-10-03', KYIV, 'start').toISOString()).toBe('2026-10-02T21:00:00.000Z');
    expect(readBound('2026-10-03', KYIV, 'end').toISOString()).toBe('2026-10-03T20:59:59.999Z');
  });

  it('takes a moment with an offset as it is', () => {
    expect(readBound('2026-10-03T10:00:00+02:00', KYIV, 'start').toISOString()).toBe('2026-10-03T08:00:00.000Z');
    expect(readBound('2026-10-03T10:00Z', KYIV, 'end').toISOString()).toBe('2026-10-03T10:00:00.000Z');
  });

  it.each(['2026-02-30', '2026-10-03T10:00', 'yesterday', '03.10.2026'])('refuses %j', (value) => {
    expect(() => readBound(value, KYIV, 'start')).toThrow(ToolInputError);
  });
});

describe('rangePeriod', () => {
  it('covers both days whole', () => {
    expect(rangePeriod('2026-10-01', '2026-10-07', KYIV)).toMatchObject({ firstDay: '2026-10-01', lastDay: '2026-10-07' });
  });

  it('refuses a range that runs backwards', () => {
    expect(() => rangePeriod('2026-10-07', '2026-10-01', KYIV)).toThrow(/comes after/);
  });
});

describe('daysCounted', () => {
  const october = monthPeriod('2026-10', KYIV);

  it('counts the days that have come, today included', () => {
    // 22:30 UTC on the 11th is already the 12th in Kyiv.
    expect(daysCounted(october, new Date('2026-10-11T22:30:00Z'), KYIV)).toBe(12);
  });

  it('counts all of a month gone by, and none of one to come', () => {
    expect(daysCounted(october, new Date('2026-11-15T12:00:00Z'), KYIV)).toBe(31);
    expect(daysCounted(october, new Date('2026-09-15T12:00:00Z'), KYIV)).toBe(0);
  });
});

describe('local dates', () => {
  it('give the date and time as the person reads them', () => {
    expect(localDateTime(new Date('2026-10-11T22:30:00Z'), KYIV)).toBe('2026-10-12T01:30+03:00');
    expect(currentMonth(new Date('2026-09-30T22:30:00Z'), KYIV)).toBe('2026-10');
  });
});
