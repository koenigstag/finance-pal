import type { EntityManager } from 'typeorm';
import type { RecurringRule } from '@ft/api-database';
import { isPositiveMoney } from '@ft/shared-contracts';
import type { RateLookup } from '../ledger/exchange-rates/exchange-rates.service';
import { convertedDest } from '../ledger/transactions/dest-amount';
import { derivedAmount, isFromBalance } from './derived-amount';
import { firstIndexAtOrAfter, firstOccurrenceAtOrAfter, occurrenceAt, startOfLocalDay, type Schedule } from './recurrence-dates';

// A series writes one row per run, a few when it has some catching up to do. This only exists to
// stop a runaway loop from a bad schedule; hitting it leaves the frontier where it stopped, and the
// next run carries on from there.
const MAX_OCCURRENCES_PER_RUN = 400;

/**
 * SQL saying that `t` (a transactions alias) is its series' planned occurrence: not deleted, and
 * still ahead of `now` (a placeholder) both by its date and by the date it was scheduled for. The
 * second half is for an occurrence the user moved later than scheduled: once its scheduled date
 * passes it stops holding the series back, and the next one is written on time rather than only
 * after the moved one lands.
 */
export function plannedOccurrence(t: string, now: string): string {
  return `${t}.deleted_at IS NULL AND ${t}.date > ${now} AND ${t}.recurrence_date > ${now}`;
}

// Taken before looking at the series, so that two writers of it — the scheduler, and a request
// editing one of its occurrences — each see what the other wrote instead of both writing the next
// occurrence, one after the other.
const LOCK_RULE_SQL = `SELECT id FROM recurring_rules WHERE id = $1 FOR UPDATE`;

const HAS_PLANNED_SQL = `
  SELECT 1 FROM transactions t
  WHERE t.recurring_rule_id = $1 AND ${plannedOccurrence('t', '$2')}
  LIMIT 1
`;

const PLANNED_DATES_SQL = `
  SELECT t.recurring_rule_id AS rule_id, MIN(t.recurrence_date) AS recurrence_date
  FROM transactions t
  WHERE t.recurring_rule_id = ANY($1) AND ${plannedOccurrence('t', '$2')}
  GROUP BY t.recurring_rule_id
`;

// ON CONFLICT names the partial unique index's predicate — Postgres only infers a partial index
// as the arbiter when the WHERE clause is spelled out. A conflict means that occurrence already
// exists: written earlier, edited by the user, or deleted by them to skip it.
const INSERT_OCCURRENCE_SQL = `
  INSERT INTO transactions (
    group_id, type, date, amount, currency_id, account_id, category_id, subcategory_id, to_account_id,
    note, recurring_rule_id, recurrence_date, is_customized, created_by,
    percentage, percentage_base, percentage_as_of, round_balance_to, dest_amount, dest_amount_as_of
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $3, false, $12, $13, $14, $15, $16, $17, $18)
  ON CONFLICT (recurring_rule_id, recurrence_date) WHERE recurring_rule_id IS NOT NULL DO NOTHING
  RETURNING id
`;

const MOVE_FRONTIER_SQL = `UPDATE recurring_rules SET next_run_date = $2 WHERE id = $1`;

// The currencies of a transfer's two accounts, for converting what it sends into what arrives.
const PAIR_SQL = `
  SELECT fc.code AS from_code, tc.code AS to_code
  FROM accounts fa
  JOIN currencies fc ON fc.id = fa.currency_id
  JOIN accounts ta ON ta.id = $2
  JOIN currencies tc ON tc.id = ta.currency_id
  WHERE fa.id = $1
`;

// Only rows the series still owns: not yet happened, never edited, not skipped by the user.
// A hard delete, not a soft one — these were generated, never occurred and hold no user input,
// and a soft-deleted row would keep blocking its date through the unique index.
const DELETE_FUTURE_OCCURRENCES_SQL = `
  DELETE FROM transactions
  WHERE recurring_rule_id = $1
    AND recurrence_date > $2
    AND is_customized = false
    AND deleted_at IS NULL
`;

// Out of the series, and so out of the unique index and any later rewrite: transactions of their
// own, as if entered by hand.
const DETACH_FUTURE_OCCURRENCES_SQL = `
  UPDATE transactions SET recurring_rule_id = NULL, recurrence_date = NULL, is_customized = false
  WHERE recurring_rule_id = $1
    AND date > $2
    AND deleted_at IS NULL
`;

interface OccurrenceAmount {
  amount: string;
  // See transactions.percentage_as_of: set for an amount that comes from the balance.
  asOf: Date | null;
}

/**
 * An occurrence's amount as it's written. A fixed series: its amount. A percentage of a base
 * amount: what that comes to, the same every time. A percentage or a rounding of the balance: from
 * the balance on its date — final for a date already past (catching up), and for the planned one an
 * estimate from what's known now, which follows its account until the date comes (see
 * reworkEstimates) and may be nothing for now. A date already past that comes to nothing isn't
 * written at all (null): nothing was charged.
 */
async function occurrenceAmount(manager: EntityManager, rule: RecurringRule, date: Date, now: Date): Promise<OccurrenceAmount | null> {
  if (rule.percentage === null && rule.roundBalanceTo === null) {
    return { amount: rule.amount, asOf: null };
  }
  const source = {
    type: rule.type,
    accountId: rule.accountId,
    percentage: rule.percentage,
    percentageBase: rule.percentageBase,
    roundBalanceTo: rule.roundBalanceTo,
  };
  const amount = await derivedAmount(manager, source, date);
  if (!isFromBalance(source)) {
    return { amount: isPositiveMoney(amount) ? amount : rule.amount, asOf: null };
  }
  const passed = date.getTime() <= now.getTime();
  if (passed) {
    return isPositiveMoney(amount) ? { amount, asOf: date } : null;
  }
  return { amount, asOf: now };
}

/**
 * How a series' occurrences convert what they send into what arrives: not at all (null) when
 * nothing crosses currencies — one currency, or not a transfer — and otherwise at the rate for its
 * pair as it stands now, itself null when there's none to be had, which the series waits out (see
 * materializeOccurrences).
 */
async function seriesConversion(
  manager: EntityManager,
  rule: RecurringRule,
  rateBetween: RateLookup,
): Promise<{ rate: string | null } | null> {
  if (!rule.toAccountId) {
    return null;
  }
  const [pair]: { from_code: string; to_code: string }[] = await manager.query(PAIR_SQL, [rule.accountId, rule.toAccountId]);
  if (!pair || pair.from_code === pair.to_code) {
    return null;
  }
  return { rate: await rateBetween(pair.from_code, pair.to_code) };
}

function scheduleOf(rule: RecurringRule): Schedule {
  return {
    startsAt: rule.startsAt,
    intervalUnit: rule.intervalUnit,
    intervalValue: rule.intervalValue,
    timezone: rule.timezone,
  };
}

/**
 * Writes the series' occurrences from its frontier up to and including the first one ahead of
 * `now`: its planned transaction. The occurrence after that is only written once the planned one
 * has landed — its date has passed and it counts like any other transaction — so a series shows
 * one upcoming transaction at a time, and until then this writes nothing.
 *
 * Nothing is skipped on the way. An occurrence that fell due while the scheduler wasn't running, or
 * between a start date in the past and today, is written as one that happened — unless it's a
 * percentage or a rounding of a balance that came to nothing then (see occurrenceAmount). A date
 * the user deleted, or an occurrence they moved, keeps its row and is stepped over.
 *
 * A transfer between currencies receives what it sends converted at the rate as it stands now:
 * final for an occurrence already past, and for the planned one an estimate that follows the rate
 * until its date (see reworkRateEstimates), when it's fixed at that day's rate. With no rate to be
 * had for the pair, the series writes nothing and keeps its frontier, and carries on once there is
 * one: an occurrence that credited what it sent in the wrong currency would be worse than a late one.
 * Setting such a series up is refused in the first place, so this only covers a provider that stops
 * quoting a currency afterwards.
 *
 * Must run inside the caller's transaction so the inserts and the frontier move commit or fail
 * together. Returns the number of rows inserted.
 */
export async function materializeOccurrences(
  manager: EntityManager,
  rule: RecurringRule,
  now: Date,
  rateBetween: RateLookup,
): Promise<number> {
  await manager.query(LOCK_RULE_SQL, [rule.id]);
  const planned: unknown[] = await manager.query(HAS_PLANNED_SQL, [rule.id, now]);
  if (planned.length > 0) {
    return 0;
  }
  const conversion = await seriesConversion(manager, rule, rateBetween);
  if (conversion?.rate === null) {
    return 0;
  }
  // Only set for a series that converts, and then never null past the return above.
  const rate = conversion?.rate ?? null;

  const schedule = scheduleOf(rule);
  let k = firstIndexAtOrAfter(schedule, rule.nextRunDate);
  let inserted = 0;
  for (let i = 0; i < MAX_OCCURRENCES_PER_RUN; i++) {
    const date = occurrenceAt(schedule, k);
    const worked = await occurrenceAmount(manager, rule, date, now);
    const rows: { id: string }[] = worked
      ? await manager.query(INSERT_OCCURRENCE_SQL, [
          rule.groupId,
          rule.type,
          date,
          worked.amount,
          rule.currencyId,
          rule.accountId,
          rule.categoryId,
          rule.subcategoryId,
          rule.toAccountId,
          rule.note,
          rule.id,
          rule.createdBy,
          rule.percentage,
          rule.percentageBase,
          worked.asOf,
          rule.roundBalanceTo,
          rate !== null ? convertedDest(worked.amount, rate) : null,
          rate !== null ? now : null,
        ])
      : [];
    inserted += rows.length;
    k++;
    if (rows.length > 0 && date.getTime() > now.getTime()) {
      break;
    }
  }

  const frontier = occurrenceAt(schedule, k);
  // Skipped when nothing moved: the scheduler runs this for every series waiting on its next
  // occurrence, and a no-op UPDATE would still bump updated_at through its trigger each time.
  if (frontier.getTime() !== rule.nextRunDate.getTime()) {
    await moveFrontier(manager, rule, frontier);
  }
  return inserted;
}

/** Removes occurrences the series still owns after `now`; see DELETE_FUTURE_OCCURRENCES_SQL. */
export async function removeFutureOccurrences(manager: EntityManager, ruleId: string, now: Date): Promise<void> {
  await manager.query(DELETE_FUTURE_OCCURRENCES_SQL, [ruleId, now]);
}

/** Turns the series' occurrences still ahead of `now` into one-off transactions. */
export async function detachFutureOccurrences(manager: EntityManager, ruleId: string, now: Date): Promise<void> {
  await manager.query(DETACH_FUTURE_OCCURRENCES_SQL, [ruleId, now]);
}

/**
 * Rewrites the series ahead of now after its template or schedule changed: drops the occurrences
 * it still owns and writes its next one afresh. A change applies from today on — the frontier goes
 * back to the start of today and no further, so a new schedule is never written into the past — and
 * rows the user edited or deleted survive, the unique index making the refill step over their dates.
 */
export async function regenerateOccurrences(
  manager: EntityManager,
  rule: RecurringRule,
  now: Date,
  rateBetween: RateLookup,
): Promise<number> {
  await removeFutureOccurrences(manager, rule.id, now);
  // Saved even if nothing gets written now (an occurrence the user edited is still the planned
  // one): the series must carry on from the new schedule once that one lands, not from the old.
  await moveFrontier(manager, rule, startOfLocalDay(now, rule.timezone));
  return materializeOccurrences(manager, rule, now, rateBetween);
}

/** The scheduled date of each series' planned occurrence, for the series that have one. */
export async function plannedOccurrenceDates(manager: EntityManager, ruleIds: string[], now: Date): Promise<Map<string, Date>> {
  if (ruleIds.length === 0) {
    return new Map();
  }
  const rows: { rule_id: string; recurrence_date: Date }[] = await manager.query(PLANNED_DATES_SQL, [ruleIds, now]);
  return new Map(rows.map((row) => [row.rule_id, new Date(row.recurrence_date)]));
}

/**
 * When the series next produces a transaction: the scheduled date of its planned occurrence (see
 * plannedOccurrenceDates), or — in the minutes between one landing and the next being written —
 * the schedule's next date from its frontier on. Null while it's paused.
 */
export function nextOccurrence(rule: RecurringRule, planned: Date | undefined, now: Date): Date | null {
  if (!rule.active) {
    return null;
  }
  if (planned) {
    return planned;
  }
  const bound = rule.nextRunDate.getTime() > now.getTime() ? rule.nextRunDate : now;
  return firstOccurrenceAtOrAfter(scheduleOf(rule), bound);
}

async function moveFrontier(manager: EntityManager, rule: RecurringRule, frontier: Date): Promise<void> {
  await manager.query(MOVE_FRONTIER_SQL, [rule.id, frontier]);
  rule.nextRunDate = frontier;
}
