import type { EntityManager } from 'typeorm';
import type { RecurringRule } from '@ft/api-database';
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
    note, recurring_rule_id, recurrence_date, is_customized, created_by
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $3, false, $12)
  ON CONFLICT (recurring_rule_id, recurrence_date) WHERE recurring_rule_id IS NOT NULL DO NOTHING
  RETURNING id
`;

const MOVE_FRONTIER_SQL = `UPDATE recurring_rules SET next_run_date = $2 WHERE id = $1`;

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
 * between a start date in the past and today, is written as one that happened. A date the user
 * deleted, or an occurrence they moved, keeps its row and is stepped over.
 *
 * Must run inside the caller's transaction so the inserts and the frontier move commit or fail
 * together. Returns the number of rows inserted.
 */
export async function materializeOccurrences(manager: EntityManager, rule: RecurringRule, now: Date): Promise<number> {
  await manager.query(LOCK_RULE_SQL, [rule.id]);
  const planned: unknown[] = await manager.query(HAS_PLANNED_SQL, [rule.id, now]);
  if (planned.length > 0) {
    return 0;
  }

  const schedule = scheduleOf(rule);
  let k = firstIndexAtOrAfter(schedule, rule.nextRunDate);
  let inserted = 0;
  for (let i = 0; i < MAX_OCCURRENCES_PER_RUN; i++) {
    const date = occurrenceAt(schedule, k);
    const rows: { id: string }[] = await manager.query(INSERT_OCCURRENCE_SQL, [
      rule.groupId,
      rule.type,
      date,
      rule.amount,
      rule.currencyId,
      rule.accountId,
      rule.categoryId,
      rule.subcategoryId,
      rule.toAccountId,
      rule.note,
      rule.id,
      rule.createdBy,
    ]);
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
export async function regenerateOccurrences(manager: EntityManager, rule: RecurringRule, now: Date): Promise<number> {
  await removeFutureOccurrences(manager, rule.id, now);
  // Saved even if nothing gets written now (an occurrence the user edited is still the planned
  // one): the series must carry on from the new schedule once that one lands, not from the old.
  await moveFrontier(manager, rule, startOfLocalDay(now, rule.timezone));
  return materializeOccurrences(manager, rule, now);
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
