import type { EntityManager } from 'typeorm';
import { RecurringRule } from '@ft/api-database';
import { firstIndexAtOrAfter, gapCutoff, horizonEnd, occurrenceAt, type Schedule } from './recurrence-dates';

// A daily rule needs about 62 rows to cover through the end of next month. This only exists to
// stop a runaway loop from a bad schedule; hitting it leaves the frontier where it stopped, and
// the next run carries on from there.
const MAX_OCCURRENCES_PER_RUN = 400;

// ON CONFLICT names the partial unique index's predicate — Postgres only infers a partial index
// as the arbiter when the WHERE clause is spelled out. A conflict means that occurrence already
// exists: materialized earlier, edited by the user, or deleted by them to skip it.
const INSERT_OCCURRENCE_SQL = `
  INSERT INTO transactions (
    group_id, type, date, amount, currency_id, account_id, category_id, subcategory_id, to_account_id,
    note, recurring_rule_id, recurrence_date, is_customized, created_by
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $3, false, $12)
  ON CONFLICT (recurring_rule_id, recurrence_date) WHERE recurring_rule_id IS NOT NULL DO NOTHING
  RETURNING id
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

function scheduleOf(rule: RecurringRule): Schedule {
  return {
    startsAt: rule.startsAt,
    intervalUnit: rule.intervalUnit,
    intervalValue: rule.intervalValue,
    timezone: rule.timezone,
  };
}

/**
 * Writes the rule's occurrences as transactions from its frontier (or the start of today,
 * whichever is later — a gap from downtime is skipped, not backfilled) through the end of next
 * month, then moves the frontier past them. Must run inside the caller's transaction so the
 * inserts and the frontier move commit or fail together. Returns the number of rows inserted.
 */
export async function materializeOccurrences(manager: EntityManager, rule: RecurringRule, now: Date): Promise<number> {
  const schedule = scheduleOf(rule);
  const cutoff = gapCutoff(now, rule.timezone);
  const start = rule.nextRunDate.getTime() > cutoff.getTime() ? rule.nextRunDate : cutoff;
  const end = horizonEnd(now, rule.timezone).getTime();

  let k = firstIndexAtOrAfter(schedule, start);
  let inserted = 0;
  for (let i = 0; i < MAX_OCCURRENCES_PER_RUN; i++) {
    const date = occurrenceAt(schedule, k);
    if (date.getTime() > end) {
      break;
    }
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
  }

  const frontier = occurrenceAt(schedule, k);
  // Skipped when nothing moved: the scheduler runs this for every candidate rule each hour, and
  // a no-op UPDATE would still bump updated_at through its trigger on every one of them.
  if (frontier.getTime() !== rule.nextRunDate.getTime()) {
    await manager.update(RecurringRule, { id: rule.id }, { nextRunDate: frontier });
    rule.nextRunDate = frontier;
  }
  return inserted;
}

/** Removes occurrences the series still owns after `now`; see DELETE_FUTURE_OCCURRENCES_SQL. */
export async function removeFutureOccurrences(manager: EntityManager, ruleId: string, now: Date): Promise<void> {
  await manager.query(DELETE_FUTURE_OCCURRENCES_SQL, [ruleId, now]);
}

/**
 * Regenerates the series from the start of today after its template or schedule changed:
 * drops the occurrences it still owns, rewinds the frontier and fills the horizon again. Rows the
 * user edited or deleted survive — the unique index makes the refill skip their dates.
 */
export async function regenerateOccurrences(manager: EntityManager, rule: RecurringRule, now: Date): Promise<number> {
  await removeFutureOccurrences(manager, rule.id, now);
  rule.nextRunDate = gapCutoff(now, rule.timezone);
  return materializeOccurrences(manager, rule, now);
}
