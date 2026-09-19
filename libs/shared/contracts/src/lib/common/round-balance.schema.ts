import { z } from 'zod';

/**
 * What "Round the balance" rounds to: an amount worked out as whatever leaves the account's
 * balance on a multiple of one of these once the transaction goes through. Whole units only, so
 * "To 1" clears the cents.
 */
export const ROUND_BALANCE_STEPS = [1, 10, 100, 1000] as const;
export type RoundBalanceStep = (typeof ROUND_BALANCE_STEPS)[number];

export const roundBalanceToSchema = z.union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)]);

export function isRoundBalanceStep(value: number): value is RoundBalanceStep {
  return (ROUND_BALANCE_STEPS as readonly number[]).includes(value);
}
