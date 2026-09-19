import type { EntityManager } from 'typeorm';

// The account's balance as of $2 is the sum of what every transaction dated up to then put into
// it — the same function the balance trigger applies — leaving out $4, the transaction being
// worked out. Taken as a positive figure, like the app does, and rounded to the cent half away
// from zero, which is how numeric round() rounds and how the app's percentOf() rounds too.
const PERCENT_OF_BALANCE_SQL = `
  SELECT round(abs(COALESCE(SUM(transaction_balance_contribution(
           t.deleted_at, t.type, t.amount, t.dest_amount, t.account_id, t.to_account_id, $1
         )), 0)) * $3::numeric / 100, 2)::text AS amount
  FROM transactions t
  WHERE (t.account_id = $1 OR t.to_account_id = $1)
    AND t.deleted_at IS NULL
    AND t.date <= $2
    AND t.id IS DISTINCT FROM $4::uuid
`;

const PERCENT_OF_BASE_SQL = `SELECT round($1::numeric * $2::numeric / 100, 2)::text AS amount`;

export interface PercentageTemplate {
  accountId: string;
  percentage: string;
  percentageBase: string | null;
}

/**
 * What a percentage comes to: of its base amount when there is one, otherwise of the account's
 * balance as of `at`, leaving out `excludeId` (the transaction being worked out, if it exists yet).
 * "0.00" when there's nothing to take it of.
 */
export async function percentageAmount(
  manager: EntityManager,
  template: PercentageTemplate,
  at: Date,
  excludeId: string | null = null,
): Promise<string> {
  const rows: { amount: string }[] =
    template.percentageBase !== null
      ? await manager.query(PERCENT_OF_BASE_SQL, [template.percentageBase, template.percentage])
      : await manager.query(PERCENT_OF_BALANCE_SQL, [template.accountId, at, template.percentage, excludeId]);
  return rows[0].amount;
}
