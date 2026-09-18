import { firstIndexAtOrAfter, firstOccurrenceAtOrAfter, occurrenceAt, startOfLocalDay, type Schedule } from './recurrence-dates';

const iso = (date: Date) => date.toISOString();

describe('occurrenceAt', () => {
  const monthlyFrom31st: Schedule = {
    startsAt: new Date('2027-01-31T06:00:00Z'), // 09:00 in Moscow
    intervalUnit: 'month',
    intervalValue: 1,
    timezone: 'Europe/Moscow',
  };

  it('clamps to the last day of shorter months', () => {
    expect(iso(occurrenceAt(monthlyFrom31st, 1))).toBe('2027-02-28T06:00:00.000Z');
    expect(iso(occurrenceAt(monthlyFrom31st, 3))).toBe('2027-04-30T06:00:00.000Z');
  });

  it('returns to the 31st after a short month instead of drifting', () => {
    expect(iso(occurrenceAt(monthlyFrom31st, 2))).toBe('2027-03-31T06:00:00.000Z');
  });

  it('keeps the local wall-clock time across a DST change', () => {
    const biweekly: Schedule = {
      startsAt: new Date('2027-03-07T14:00:00Z'), // 09:00 EST
      intervalUnit: 'week',
      intervalValue: 2,
      timezone: 'America/New_York',
    };
    expect(iso(occurrenceAt(biweekly, 1))).toBe('2027-03-21T13:00:00.000Z'); // 09:00 EDT
  });

  it('handles a leap-day anchor', () => {
    const yearly: Schedule = {
      startsAt: new Date('2028-02-29T10:00:00Z'),
      intervalUnit: 'year',
      intervalValue: 1,
      timezone: 'UTC',
    };
    expect(iso(occurrenceAt(yearly, 1))).toBe('2029-02-28T10:00:00.000Z');
    expect(iso(occurrenceAt(yearly, 4))).toBe('2032-02-29T10:00:00.000Z');
  });
});

describe('firstIndexAtOrAfter', () => {
  const monthly: Schedule = {
    startsAt: new Date('2027-01-31T06:00:00Z'),
    intervalUnit: 'month',
    intervalValue: 1,
    timezone: 'Europe/Moscow',
  };

  it('is 0 for a bound before the anchor', () => {
    expect(firstIndexAtOrAfter(monthly, new Date('2020-01-01T00:00:00Z'))).toBe(0);
  });

  it('includes an occurrence exactly on the bound', () => {
    expect(firstIndexAtOrAfter(monthly, new Date('2027-02-28T06:00:00Z'))).toBe(1);
  });

  it('moves to the next occurrence one millisecond later', () => {
    expect(firstIndexAtOrAfter(monthly, new Date('2027-02-28T06:00:00.001Z'))).toBe(2);
  });

  it('lands between clamped month ends', () => {
    expect(firstIndexAtOrAfter(monthly, new Date('2027-03-01T00:00:00Z'))).toBe(2);
  });

  it('respects intervalValue for days', () => {
    const everyThirdDay: Schedule = {
      startsAt: new Date('2027-01-01T08:00:00Z'),
      intervalUnit: 'day',
      intervalValue: 3,
      timezone: 'UTC',
    };
    // Jan 1, 4, 7, 10 08:00 — Jan 10 09:00 is past the 4th (index 3), so the answer is Jan 13.
    expect(firstIndexAtOrAfter(everyThirdDay, new Date('2027-01-10T09:00:00Z'))).toBe(4);
  });
});

describe('firstOccurrenceAtOrAfter', () => {
  it('is the occurrence itself, not its index', () => {
    const monthly: Schedule = {
      startsAt: new Date('2027-01-31T06:00:00Z'),
      intervalUnit: 'month',
      intervalValue: 1,
      timezone: 'Europe/Moscow',
    };
    expect(iso(firstOccurrenceAtOrAfter(monthly, new Date('2027-03-01T00:00:00Z')))).toBe('2027-03-31T06:00:00.000Z');
  });
});

describe('startOfLocalDay', () => {
  it('is midnight on the calendar day in the zone, not in UTC', () => {
    // 23:30 UTC on Jan 15 is already 02:30 on Jan 16 in Moscow.
    const now = new Date('2027-01-15T23:30:00Z');
    expect(iso(startOfLocalDay(now, 'Europe/Moscow'))).toBe('2027-01-15T21:00:00.000Z');
    expect(iso(startOfLocalDay(now, 'UTC'))).toBe('2027-01-15T00:00:00.000Z');
  });
});
