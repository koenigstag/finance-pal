import type { EntityManager } from 'typeorm';
import { isRoundBalanceStep, percentOf, roundBalanceAmount } from '@ft/shared-contracts';

// The account's balance as of $2: the sum of what every transaction dated up to then puts into it,
// planned ones included — the same function the balance trigger applies — leaving out $3, the
// transaction being worked out.
const BALANCE_SQL = `
  SELECT COALESCE(SUM(transaction_balance_contribution(
           t.deleted_at, t.type, t.amount, t.dest_amount, t.account_id, t.to_account_id, $1
         )), 0)::text AS balance
  FROM transactions t
  WHERE (t.account_id = $1 OR t.to_account_id = $1)
    AND t.deleted_at IS NULL
    AND t.date <= $2
    AND t.id IS DISTINCT FROM $3::uuid
`;

/** What an amount can be worked out from: a transaction's or a series' fields for it. */
export interface AmountSource {
  // Which way the money goes, for rounding: an income rounds its account up, the rest down.
  type: string;
  accountId: string;
  percentage: string | null;
  percentageBase: string | null;
  roundBalanceTo: number | null;
}

/**
 * Whether the amount comes from the account's balance — a percentage of it (no base amount), or
 * rounding it — and so depends on when it's worked out.
 */
export function isFromBalance(source: Pick<AmountSource, 'percentage' | 'percentageBase' | 'roundBalanceTo'>): boolean {
  return (source.percentage !== null && source.percentageBase === null) || source.roundBalanceTo !== null;
}

/**
 * What a percentage or a rounding comes to: of its base amount when it has one, otherwise from the
 * account's balance as of `at`, leaving out `excludeId` (the transaction being worked out, once it
 * exists). "0.00" when there's nothing to take or to round.
 */
export async function derivedAmount(
  manager: EntityManager,
  source: AmountSource,
  at: Date,
  excludeId: string | null = null,
): Promise<string> {
  if (source.percentage !== null && source.percentageBase !== null) {
    return percentOf(source.percentageBase, source.percentage);
  }
  const [{ balance }]: { balance: string }[] = await manager.query(BALANCE_SQL, [source.accountId, at, excludeId]);
  if (source.percentage !== null) {
    return percentOf(balance, source.percentage);
  }
  if (source.roundBalanceTo !== null && isRoundBalanceStep(source.roundBalanceTo)) {
    return roundBalanceAmount(balance, source.roundBalanceTo, source.type === 'income' ? 'in' : 'out');
  }
  throw new Error('A derived amount needs a percentage or a step to round to');
}
