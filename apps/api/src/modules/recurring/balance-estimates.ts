import type { EntityManager } from 'typeorm';
import { isPositiveMoney } from '@ft/shared-contracts';
import { derivedAmount } from './derived-amount';

// Amounts from a balance that are still estimates — worked out before their date — on the given
// accounts, or on every one when $1 is null. Earliest first, so one worked out later sees what an
// earlier one came to; locked, since a request and the scheduler may both be at them.
const ESTIMATES_SQL = `
  SELECT id, group_id, type, account_id, date, amount, percentage, percentage_base, round_balance_to
  FROM transactions
  WHERE percentage_as_of < date AND deleted_at IS NULL
    AND ($1::uuid[] IS NULL OR account_id = ANY($1::uuid[]))
  ORDER BY date, id
  FOR UPDATE
`;

// A transfer between currencies keeps the rate its two amounts were entered at: the received amount
// moves with the sent one (the right-hand side reads the row as it was).
const SET_AMOUNT_SQL = `
  UPDATE transactions
  SET amount = $2,
      dest_amount = CASE WHEN dest_amount IS NULL THEN NULL ELSE GREATEST(round(dest_amount * $2::numeric / amount, 2), 0.01) END,
      percentage_as_of = $3
  WHERE id = $1
`;

// Worked out on its date to nothing: no money moved, so there's no transaction to keep.
const TO_NOTHING_SQL = `UPDATE transactions SET deleted_at = now(), percentage_as_of = date WHERE id = $1`;

interface EstimateRow {
  id: string;
  group_id: string;
  type: string;
  account_id: string;
  date: Date;
  amount: string;
  percentage: string | null;
  percentage_base: string | null;
  round_balance_to: number | null;
}

export interface ReworkedAmount {
  id: string;
  groupId: string;
  action: 'updated' | 'deleted';
}

/**
 * Brings the amounts on these accounts (null: every account) that come from a balance and are still
 * estimates in line with it, earliest first. A planned one follows its account: it's worked out from
 * the balance its date will have as things stand, the balance now and everything planned before it.
 * One whose date has come is worked out a last time, from the balance on that date, and stays as it
 * came out; or goes, if that's nothing. A planned one that comes to nothing for now keeps the figure
 * it had until then. Returns what changed.
 */
export async function reworkEstimates(manager: EntityManager, accountIds: string[] | null, now: Date): Promise<ReworkedAmount[]> {
  const rows: EstimateRow[] = await manager.query(ESTIMATES_SQL, [accountIds]);
  const reworked: ReworkedAmount[] = [];
  for (const row of rows) {
    const amount = await derivedAmount(
      manager,
      {
        type: row.type,
        accountId: row.account_id,
        percentage: row.percentage,
        percentageBase: row.percentage_base,
        roundBalanceTo: row.round_balance_to,
      },
      row.date,
      row.id,
    );
    const landed = row.date.getTime() <= now.getTime();
    if (!isPositiveMoney(amount)) {
      if (landed) {
        await manager.query(TO_NOTHING_SQL, [row.id]);
        reworked.push({ id: row.id, groupId: row.group_id, action: 'deleted' });
      }
      continue;
    }
    // Landed, it's written even when the figure holds: taken as of its date, it's no estimate now.
    if (landed || amount !== row.amount) {
      await manager.query(SET_AMOUNT_SQL, [row.id, amount, landed ? row.date : now]);
      reworked.push({ id: row.id, groupId: row.group_id, action: 'updated' });
    }
  }
  return reworked;
}
