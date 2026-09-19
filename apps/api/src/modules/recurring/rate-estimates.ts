import type { EntityManager } from 'typeorm';
import type { RateLookup } from '../ledger/exchange-rates/exchange-rates.service';
import { convertedDest } from '../ledger/transactions/dest-amount';

// Transfers whose received amount was converted at a rate and is still an estimate — worked out
// before the transfer's date — touching the given accounts, or every one when $1 is null. With the
// two currencies' codes, for the rate. Locked, since a request and the scheduler may both be at them.
const RATE_ESTIMATES_SQL = `
  SELECT t.id, t.group_id, t.date, t.amount, t.dest_amount, fc.code AS from_code, tc.code AS to_code
  FROM transactions t
  JOIN accounts fa ON fa.id = t.account_id
  JOIN accounts ta ON ta.id = t.to_account_id
  JOIN currencies fc ON fc.id = fa.currency_id
  JOIN currencies tc ON tc.id = ta.currency_id
  WHERE t.dest_amount_as_of < t.date AND t.deleted_at IS NULL
    AND ($1::uuid[] IS NULL OR t.account_id = ANY($1::uuid[]) OR t.to_account_id = ANY($1::uuid[]))
  ORDER BY t.date, t.id
  FOR UPDATE OF t
`;

// The currencies a tick may convert into: those of every estimate still pending, and of every
// active transfer series between two currencies, which may write its next occurrence. What the
// scheduler warms before it locks anything.
const RATES_TO_WARM_SQL = `
  SELECT tc.code
  FROM transactions t
  JOIN accounts ta ON ta.id = t.to_account_id
  JOIN currencies tc ON tc.id = ta.currency_id
  WHERE t.dest_amount_as_of < t.date AND t.deleted_at IS NULL
  UNION
  SELECT tc.code
  FROM recurring_rules r
  JOIN accounts fa ON fa.id = r.account_id
  JOIN accounts ta ON ta.id = r.to_account_id
  JOIN currencies tc ON tc.id = ta.currency_id
  WHERE r.active AND r.deleted_at IS NULL AND fa.currency_id <> ta.currency_id
`;

// Landed ($4), it's fixed as of its own date, taken from the column: a date read into JavaScript
// loses its microseconds, and written back it would fall just short of the stored one - leaving
// the row an estimate, reworked on every run for good.
const SET_DEST_SQL = `
  UPDATE transactions
  SET dest_amount = $2,
      dest_amount_as_of = CASE WHEN $4::boolean THEN date ELSE $3::timestamptz END
  WHERE id = $1
`;

interface RateEstimateRow {
  id: string;
  group_id: string;
  date: Date;
  amount: string;
  dest_amount: string | null;
  from_code: string;
  to_code: string;
}

export interface ReworkedDest {
  id: string;
  groupId: string;
}

/** The currencies a tick may convert into, so their rates can be refreshed before any lock. */
export async function ratesToWarm(manager: EntityManager): Promise<string[]> {
  const rows: { code: string }[] = await manager.query(RATES_TO_WARM_SQL);
  return rows.map((row) => row.code);
}

/**
 * Brings the received amounts on these accounts (null: every account) that were converted at a
 * rate and are still estimates in line with the latest rate, earliest first. One whose date has
 * come is worked out a last time, at the rate as it stands that day, and stays as it came out.
 *
 * Run after the amounts from a balance are brought in line (see reworkEstimates), so a received
 * amount follows what's sent as well as the rate.
 *
 * Without a rate for the pair — a provider that stopped quoting a currency — an estimate stays as it
 * was, and one that lands is fixed at its last estimate: the best figure known, and far better than
 * crediting the amount sent in the wrong currency. Returns what changed.
 */
export async function reworkRateEstimates(
  manager: EntityManager,
  rateBetween: RateLookup,
  accountIds: string[] | null,
  now: Date,
): Promise<ReworkedDest[]> {
  const rows: RateEstimateRow[] = await manager.query(RATE_ESTIMATES_SQL, [accountIds]);
  // Many rows share a pair; one lookup each is enough for a run.
  const rates = new Map<string, Promise<string | null>>();
  const rateFor = (from: string, to: string) => {
    const key = `${from}>${to}`;
    if (!rates.has(key)) {
      rates.set(key, rateBetween(from, to));
    }
    return rates.get(key) as Promise<string | null>;
  };

  const reworked: ReworkedDest[] = [];
  for (const row of rows) {
    const landed = row.date.getTime() <= now.getTime();
    const rate = await rateFor(row.from_code, row.to_code);
    const destAmount = rate === null ? row.dest_amount : convertedDest(row.amount, rate);
    // Landed, it's written even when the figure holds: taken on its day, it's no estimate now.
    if (landed || destAmount !== row.dest_amount) {
      await manager.query(SET_DEST_SQL, [row.id, destAmount, now, landed]);
      reworked.push({ id: row.id, groupId: row.group_id });
    }
  }
  return reworked;
}
