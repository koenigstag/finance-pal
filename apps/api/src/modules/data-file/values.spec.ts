import {
  CellProblem,
  formatDateTime,
  fromWallClock,
  readAmount,
  readBalance,
  readBoolean,
  readChoice,
  readDateTime,
  readInteger,
  readPercentage,
  readText,
  trimPercentage,
  wallClock,
} from './values';

// UTC+9 all year round, so the expectations don't move with anyone's daylight saving rules.
const TOKYO = 'Asia/Tokyo';

describe('readAmount', () => {
  it('reads amounts as the export writes them and as people type them', () => {
    expect(readAmount('1250.50')).toBe('1250.50');
    expect(readAmount('1 250,5')).toBe('1250.5');
    // A no-break space, as a spreadsheet set to Russian groups digits.
    expect(readAmount('12 000')).toBe('12000');
    expect(readAmount('  ')).toBeNull();
    expect(readAmount(null)).toBeNull();
  });

  it('rounds a spreadsheet’s own number to the cent it shows', () => {
    expect(readAmount({ number: '1234.5' })).toBe('1234.50');
    expect(readAmount({ number: '12.345000000000001' })).toBe('12.35');
  });

  it('refuses what would take a guess, and signs', () => {
    // A thousand, or three decimals?
    expect(() => readAmount('1.234')).toThrow(CellProblem);
    expect(() => readAmount('1,234.50')).toThrow(CellProblem);
    expect(() => readAmount('-5')).toThrow(/without a sign/);
    expect(() => readAmount({ number: '-5' })).toThrow(/without a sign/);
    expect(() => readAmount('ten')).toThrow(CellProblem);
    expect(() => readAmount(true)).toThrow(CellProblem);
  });
});

describe('readBalance', () => {
  it('keeps the sign', () => {
    expect(readBalance('-1250.50')).toBe('-1250.50');
    expect(readBalance({ number: '-3' })).toBe('-3.00');
    expect(readBalance('−0')).toBe('0');
    expect(readBalance('300')).toBe('300');
  });
});

describe('readPercentage', () => {
  it('reads a number of percent, with or without the sign', () => {
    expect(readPercentage('12.5')).toBe('12.5');
    expect(readPercentage('12,50 %')).toBe('12.5');
    expect(readPercentage({ number: '3.5' })).toBe('3.5');
    expect(readPercentage('100')).toBe('100');
  });

  it('refuses nothing, more than everything, and too many decimals', () => {
    expect(() => readPercentage('0')).toThrow(CellProblem);
    expect(() => readPercentage('101')).toThrow(CellProblem);
    expect(() => readPercentage('1.23456')).toThrow(CellProblem);
  });
});

describe('readInteger', () => {
  it('reads whole numbers only', () => {
    expect(readInteger('10')).toBe(10);
    expect(readInteger({ number: '100' })).toBe(100);
    expect(() => readInteger({ number: '1.5' })).toThrow(CellProblem);
    expect(() => readInteger('ten')).toThrow(CellProblem);
    expect(() => readInteger('-1')).toThrow(CellProblem);
  });
});

describe('readBoolean', () => {
  it('reads what spreadsheets and people write for yes and no', () => {
    expect(readBoolean(true)).toBe(true);
    expect(readBoolean('TRUE')).toBe(true);
    expect(readBoolean('да')).toBe(true);
    expect(readBoolean('ИСТИНА')).toBe(true);
    expect(readBoolean('no')).toBe(false);
    expect(readBoolean({ number: '0' })).toBe(false);
    expect(readBoolean('')).toBeNull();
    expect(() => readBoolean('maybe')).toThrow(CellProblem);
  });
});

describe('readChoice', () => {
  it('matches in any case, and names the choices when nothing does', () => {
    expect(readChoice('Expense', ['expense', 'income'])).toBe('expense');
    expect(() => readChoice('spending', ['expense', 'income'])).toThrow('"spending" isn\'t one of expense, income');
  });
});

describe('readText', () => {
  it('gives back a number as written, and a date a spreadsheet made of text', () => {
    expect(readText({ number: '2024' })).toBe('2024');
    expect(readText(new Date(Date.UTC(2026, 0, 2)))).toBe('2026-01-02');
    expect(readText('  Cash  ')).toBe('Cash');
  });
});

describe('readDateTime', () => {
  it('reads a local time in the zone given', () => {
    expect(readDateTime('2026-09-21 14:30', TOKYO)?.toISOString()).toBe('2026-09-21T05:30:00.000Z');
    expect(readDateTime('2026-09-21T14:30:05', TOKYO)?.toISOString()).toBe('2026-09-21T05:30:05.000Z');
    // Without a time, the start of the day.
    expect(readDateTime('2026-09-21', TOKYO)?.toISOString()).toBe('2026-09-20T15:00:00.000Z');
    // As a spreadsheet set to most European languages writes it: day first.
    expect(readDateTime('01.02.2026 09:05', 'UTC')?.toISOString()).toBe('2026-02-01T09:05:00.000Z');
  });

  it('takes a zone or an offset in the text as given', () => {
    expect(readDateTime('2026-09-21T14:30:00Z', TOKYO)?.toISOString()).toBe('2026-09-21T14:30:00.000Z');
    expect(readDateTime('2026-09-21T14:30:00+02:00', TOKYO)?.toISOString()).toBe('2026-09-21T12:30:00.000Z');
    expect(readDateTime('2026-09-21 14:30:00.250-0130', 'UTC')?.toISOString()).toBe('2026-09-21T16:00:00.250Z');
  });

  it('reads a spreadsheet’s date as the local time it shows, to the second', () => {
    const cell = new Date(Date.UTC(2026, 8, 21, 14, 30, 4, 999));
    expect(readDateTime(cell, TOKYO)?.toISOString()).toBe('2026-09-21T05:30:05.000Z');
    // The same day as a bare number of days, a date that lost its format.
    expect(readDateTime({ number: '46286.5' }, 'UTC')?.toISOString()).toBe('2026-09-21T12:00:00.000Z');
  });

  it('refuses dates that don’t exist and forms that would take a guess', () => {
    expect(() => readDateTime('2026-02-30', 'UTC')).toThrow(/exists/);
    expect(() => readDateTime('2026-09-21 25:00', 'UTC')).toThrow(/exists/);
    expect(() => readDateTime('09/21/2026', 'UTC')).toThrow(/like 2026-09-21/);
    expect(readDateTime('', 'UTC')).toBeNull();
  });
});

describe('wallClock', () => {
  it('is the local time, and comes back to the same moment', () => {
    const instant = new Date('2026-09-21T05:30:05.000Z');
    expect(formatDateTime(wallClock(instant, TOKYO))).toBe('2026-09-21 14:30:05');
    expect(fromWallClock(wallClock(instant, TOKYO), TOKYO).toISOString()).toBe(instant.toISOString());
  });

  it('keeps to the clock across a change to summer time', () => {
    // Half an hour after Berlin moved its clocks from 2:00 to 3:00.
    const instant = new Date('2026-03-29T01:30:00.000Z');
    const wall = wallClock(instant, 'Europe/Berlin');
    expect(formatDateTime(wall)).toBe('2026-03-29 03:30:00');
    expect(fromWallClock(wall, 'Europe/Berlin').toISOString()).toBe(instant.toISOString());
  });
});

describe('trimPercentage', () => {
  it('drops the padding numeric(7,4) reads back with', () => {
    expect(trimPercentage('12.5000')).toBe('12.5');
    expect(trimPercentage('100.0000')).toBe('100');
    expect(trimPercentage('7')).toBe('7');
  });
});
