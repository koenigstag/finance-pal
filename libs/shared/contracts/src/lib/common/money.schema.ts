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
