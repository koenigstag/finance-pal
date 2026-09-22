import { TZDate } from '@date-fns/tz';
import { isPercentageInRange, parseMoneyInput, percentageSchema } from '@ft/shared-contracts';
import { isNumberCell, type Cell } from './tables';

/**
 * Reading and writing single cells. A reader takes what either file format holds — CSV cells are
 * always text, .xlsx cells may be numbers, booleans or dates — and returns the value as the API
 * stores it, null for an empty cell, or throws a CellProblem saying what's wrong with it in words
 * meant for whoever filled the table in.
 */
export class CellProblem extends Error {}

// A spreadsheet's own numbers can carry more decimals than money has (a formula's result, or a
// float's last digits); rounded to what the cell shows. Typed text isn't: "1.234" could be a
// thousand or a figure with three decimals, and parseMoneyInput refuses to guess.
function numberText(cell: Cell, places: number): string | null {
  if (isNumberCell(cell)) {
    const value = Number(cell.number);
    if (!Number.isFinite(value)) {
      throw new CellProblem(`"${cell.number}" isn't a number`);
    }
    return value.toFixed(places);
  }
  if (typeof cell === 'string') {
    const text = cell.trim();
    return text === '' ? null : text;
  }
  if (cell === null) {
    return null;
  }
  throw new CellProblem(`${describe(cell)} isn't a number`);
}

function describe(cell: Cell): string {
  if (cell instanceof Date) {
    return `The date ${formatDateTime(cell)}`;
  }
  return `"${String(isNumberCell(cell) ? cell.number : cell)}"`;
}

export function readText(cell: Cell): string | null {
  if (cell === null) {
    return null;
  }
  if (cell instanceof Date) {
    // A spreadsheet turns some text into a date as it's typed ("1-2"); give it back as written.
    return formatDateTime(cell).replace(/ 00:00:00$/, '');
  }
  const text = (isNumberCell(cell) ? cell.number : String(cell)).trim();
  return text === '' ? null : text;
}

/** An amount of money: "1250.50", or as a person types it — "1 250,50". Never negative. */
export function readAmount(cell: Cell): string | null {
  const text = numberText(cell, 2);
  if (text === null) {
    return null;
  }
  if (/^[-−]/.test(text) && parseMoneyInput(text.slice(1)) !== null) {
    throw new CellProblem(`${text} is negative: amounts are written without a sign, and the type says which way the money went`);
  }
  const amount = parseMoneyInput(text);
  if (amount === null) {
    throw new CellProblem(`"${text}" isn't an amount like 1250.50`);
  }
  return amount;
}

/** A balance: an amount that may be negative. */
export function readBalance(cell: Cell): string | null {
  const text = numberText(cell, 2);
  if (text === null) {
    return null;
  }
  const negative = /^[-−]/.test(text);
  const amount = parseMoneyInput(negative ? text.slice(1) : text);
  if (amount === null) {
    throw new CellProblem(`"${text}" isn't an amount like -1250.50`);
  }
  return negative && Number(amount) !== 0 ? `-${amount}` : amount;
}

/** A percentage, 12.5 for 12.5% (the sign may be there): above 0, at most 100. */
export function readPercentage(cell: Cell): string | null {
  const raw = numberText(cell, 4);
  if (raw === null) {
    return null;
  }
  const text = raw.replace(/\s*%$/, '').replace(',', '.').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (!percentageSchema.safeParse(text).success || !isPercentageInRange(text)) {
    throw new CellProblem(`"${raw}" isn't a percentage above 0 and at most 100, like 12.5`);
  }
  return text;
}

export function readInteger(cell: Cell): number | null {
  const text = numberText(cell, 0);
  if (text === null) {
    return null;
  }
  if (!/^\d{1,9}$/.test(text) || (isNumberCell(cell) && !Number.isInteger(Number(cell.number)))) {
    throw new CellProblem(`${describe(cell)} isn't a whole number`);
  }
  return Number(text);
}

const TRUE = new Set(['true', 'yes', 'y', '1', 'да', 'истина', 'так', 'x', '✓', '+']);
const FALSE = new Set(['false', 'no', 'n', '0', 'нет', 'ложь', 'ні', '-']);

export function readBoolean(cell: Cell): boolean | null {
  if (typeof cell === 'boolean') {
    return cell;
  }
  const text = readText(cell)?.toLowerCase() ?? null;
  if (text === null) {
    return null;
  }
  if (TRUE.has(text)) {
    return true;
  }
  if (FALSE.has(text)) {
    return false;
  }
  throw new CellProblem(`"${text}" isn't true or false`);
}

/** One of a fixed list of words, in any case: a transaction's type, a series' unit. */
export function readChoice<T extends string>(cell: Cell, choices: readonly T[]): T | null {
  const text = readText(cell)?.toLowerCase() ?? null;
  if (text === null) {
    return null;
  }
  const choice = choices.find((candidate) => candidate === text);
  if (!choice) {
    throw new CellProblem(`"${text}" isn't one of ${choices.join(', ')}`);
  }
  return choice;
}

// 2026-09-21, 2026-09-21 14:30, 2026-09-21T14:30:05.123+03:00 — with a zone or offset, the moment
// is exact; without one, it's a local time in the zone the file is read for.
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
// 21.09.2026 and 21.09.2026 14:30: how a spreadsheet set to most European languages writes a date
// into a CSV file. Day first, always, where dots separate it.
const DOTTED_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

// What a spreadsheet stores as a date is a number of days since the end of 1899. One that lost its
// date format on the way still means the day it did.
const EXCEL_DAYS_BEFORE_1970 = 25569;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A date and time as the moment it names. Without a time, the start of the day. Without a zone, a
 * local time in `timezone`: a spreadsheet keeps dates as a calendar and a clock, and a file read in
 * the zone it was written in comes back to the same moments.
 */
export function readDateTime(cell: Cell, timezone: string): Date | null {
  if (cell === null) {
    return null;
  }
  if (cell instanceof Date) {
    // A spreadsheet stores times as fractions of a day, which come back a millisecond off.
    return fromWallClock(new Date(Math.round(cell.getTime() / 1000) * 1000), timezone);
  }
  if (isNumberCell(cell)) {
    const days = Number(cell.number);
    if (!Number.isFinite(days) || days < 1 || days > 2958465) {
      throw new CellProblem(`${cell.number} isn't a date`);
    }
    const wall = new Date(Math.round(((days - EXCEL_DAYS_BEFORE_1970) * DAY_MS) / 1000) * 1000);
    return fromWallClock(wall, timezone);
  }
  const text = readText(cell);
  if (text === null) {
    return null;
  }

  let parts: { year: number; month: number; day: number; hours: number; minutes: number; seconds: number; ms: number };
  let offset: string | undefined;
  const iso = ISO_DATE.exec(text);
  const dotted = iso ? null : DOTTED_DATE.exec(text);
  if (iso) {
    const [, year, month, day, hours, minutes, seconds, fraction, zone] = iso;
    parts = {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hours: Number(hours ?? 0),
      minutes: Number(minutes ?? 0),
      seconds: Number(seconds ?? 0),
      ms: fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0,
    };
    offset = zone;
  } else if (dotted) {
    const [, day, month, year, hours, minutes, seconds] = dotted;
    parts = {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hours: Number(hours ?? 0),
      minutes: Number(minutes ?? 0),
      seconds: Number(seconds ?? 0),
      ms: 0,
    };
  } else {
    throw new CellProblem(`"${text}" isn't a date like 2026-09-21 or 2026-09-21 14:30`);
  }

  const wall = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hours, parts.minutes, parts.seconds, parts.ms));
  // Date.UTC rolls 31 February over into March; a date that doesn't exist is a mistake, not that.
  if (
    wall.getUTCFullYear() !== parts.year ||
    wall.getUTCMonth() !== parts.month - 1 ||
    wall.getUTCDate() !== parts.day ||
    wall.getUTCHours() !== parts.hours ||
    wall.getUTCMinutes() !== parts.minutes ||
    parts.seconds > 59
  ) {
    throw new CellProblem(`"${text}" isn't a date that exists`);
  }
  if (offset === undefined) {
    return fromWallClock(wall, timezone);
  }
  if (offset.toUpperCase() === 'Z') {
    return wall;
  }
  const [, sign, hours, minutes] = /^([+-])(\d{2}):?(\d{2})?$/.exec(offset) ?? [];
  const shift = (Number(hours) * 60 + Number(minutes ?? 0)) * 60_000;
  return new Date(wall.getTime() - (sign === '+' ? shift : -shift));
}

/**
 * The local time at `instant` in `timezone`, as a Date whose UTC fields hold it: how a spreadsheet
 * cell holds a date. Whole seconds; a spreadsheet keeps no more, and nor does the file.
 */
export function wallClock(instant: Date, timezone: string): Date {
  const local = new TZDate(instant, timezone);
  return new Date(
    Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds()),
  );
}

/** The moment a local time (see wallClock) names in `timezone`. */
export function fromWallClock(wall: Date, timezone: string): Date {
  const local = new TZDate(
    wall.getUTCFullYear(),
    wall.getUTCMonth(),
    wall.getUTCDate(),
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
    wall.getUTCMilliseconds(),
    timezone,
  );
  return new Date(local.getTime());
}

/** "2026-09-21 14:30:05", for a CSV cell: a local time (see wallClock), as spreadsheets read it. */
export function formatDateTime(wall: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())} ` +
    `${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:${pad(wall.getUTCSeconds())}`
  );
}

/** A stored percentage without the padding numeric(7,4) reads back with: "12.5000" → "12.5". */
export function trimPercentage(value: string): string {
  return value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
}
