import { z } from 'zod';

/**
 * Monetary amounts are numeric(14,2) in Postgres and always travel as strings.
 * The pg driver returns numeric as a string already, so this keeps the value
 * untouched end to end and avoids float rounding on large sums.
 */
export const moneySchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'invalid money format');

export type Money = z.infer<typeof moneySchema>;

// Balances, unlike amounts, go negative (an overdrawn account, a debt account). Amounts stay on
// the unsigned schema: a transaction's direction is carried by its type, never by the sign.
export const signedMoneySchema = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'invalid money format');

// A single-comparison parse, not stored or passed anywhere — safe despite money otherwise
// always traveling as a string, since float rounding only bites on repeated arithmetic.
export function isPositiveMoney(value: string): boolean {
  return Number(value) > 0;
}

/**
 * Turns an amount as a person types it, or as a bank notification prints it, into the money
 * string ("1 234,5" → "1234.5"), or null if it isn't one. Spaces may group digits and a comma may
 * be the decimal separator; anything that would take a guess — "1.234" (a thousand, or three
 * decimals?), or both separators at once — is refused rather than read one way. Money stays a
 * string end to end; this only normalizes separators.
 */
export function parseMoneyInput(input: string): string | null {
  const normalized = input
    // \s includes the no-break and narrow no-break spaces locales use for digit grouping.
    .replace(/\s/g, '')
    .replace(',', '.')
    // "12." is a half-typed "12.50"; accept it as 12.
    .replace(/\.$/, '')
    // "012" from typing after a leftover zero; keep a single zero before the point ("0.5").
    .replace(/^0+(?=\d)/, '');
  return moneySchema.safeParse(normalized).success ? normalized : null;
}
