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
