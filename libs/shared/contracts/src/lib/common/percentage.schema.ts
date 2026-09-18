import { z } from 'zod';

/**
 * A percentage travels as a decimal string, the way money does: up to three whole digits and four
 * decimals ("3.5", "0.0125", "100"), numeric(7,4) in Postgres. The format is all this checks; the
 * range is isPercentageInRange's, as an amount's sign is isPositiveMoney's.
 */
export const percentageSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, 'invalid percentage format');

// Above 0 and at most 100. Parsed only to compare, never kept, like isPositiveMoney.
export function isPercentageInRange(value: string): boolean {
  const percentage = Number(value);
  return percentage > 0 && percentage <= 100;
}
