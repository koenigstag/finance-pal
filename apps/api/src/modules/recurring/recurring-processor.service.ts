import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { RecurringRule, createMigrationDataSource } from '@ft/api-database';
import { isPositiveMoney } from '@ft/shared-contracts';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { materializeOccurrences, plannedOccurrence } from './occurrence-materializer';
import { percentageAmount } from './percentage-amount';

// Session-level advisory lock serializing ticks across every instance of the API. hashtext()
// turns a readable name into the lock key, so nothing else has to agree on a magic number.
const LOCK_SQL = `SELECT pg_try_advisory_lock(hashtext('ft:recurring-occurrences')) AS locked`;
const UNLOCK_SQL = `SELECT pg_advisory_unlock(hashtext('ft:recurring-occurrences'))`;

// Active series with no planned occurrence: the one they had has landed (or the user deleted it),
// so the next is due to be written.
const DUE_RULES_SQL = `
  SELECT r.id FROM recurring_rules r
  WHERE r.active AND r.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.recurring_rule_id = r.id AND ${plannedOccurrence('t', '$1')})
`;

// Transactions whose amount is a percentage of a balance taken before their date — a series' planned
// occurrence, or a one-off entered ahead — now that the date has passed. Earliest first, so one
// worked out later sees what an earlier one on the same account came to.
const DUE_ESTIMATES_SQL = `
  SELECT t.id FROM transactions t
  WHERE t.percentage_as_of < t.date AND t.deleted_at IS NULL AND t.date <= $1
  ORDER BY t.date, t.id
`;

// Re-read under a row lock: a request may have edited or deleted it since it was listed.
const LOCK_ESTIMATE_SQL = `
  SELECT id, group_id, account_id, date, percentage
  FROM transactions
  WHERE id = $1 AND percentage_as_of < date AND deleted_at IS NULL
  FOR UPDATE
`;

// A transfer between currencies keeps the rate its two amounts were entered at: the received amount
// moves with the sent one (the right-hand side reads the row as it was).
const SETTLE_SQL = `
  UPDATE transactions
  SET amount = $2,
      dest_amount = CASE WHEN dest_amount IS NULL THEN NULL ELSE GREATEST(round(dest_amount * $2::numeric / amount, 2), 0.01) END,
      percentage_as_of = date
  WHERE id = $1
`;

// A percentage of nothing: no money moved, so there's no transaction to keep.
const SETTLE_TO_NOTHING_SQL = `UPDATE transactions SET deleted_at = now(), percentage_as_of = date WHERE id = $1`;

// Can this connection see and write every group's rules despite RLS? Only a table's owner, a
// superuser or a BYPASSRLS role can.
const BYPASSES_RLS_SQL = `
  SELECT (r.rolsuper OR r.rolbypassrls OR t.tableowner = current_user) AS bypasses
  FROM pg_roles r, pg_tables t
  WHERE r.rolname = current_user AND t.schemaname = 'public' AND t.tablename = 'recurring_rules'
`;

/**
 * Moves every active series on to its next occurrence once its planned one lands: each series keeps
 * one upcoming transaction, and when that one's date passes this writes the one after it — or,
 * after downtime, every one that fell due meanwhile and then the next.
 *
 * Before that, it works out afresh the amounts that were only estimates: a percentage of the
 * balance taken before the transaction's date is taken again, of the balance on that date.
 *
 * Runs on its own connection as the schema owner, bypassing RLS, unlike every request-driven
 * write in the app: a background job acts for no user, and a rule's creator may have long since
 * left the group while the rule itself should keep running.
 *
 * Duplicate work is ruled out three ways: the advisory lock keeps two ticks (other instances, or
 * a tick overrunning the next) from running at once; each rule's inserts and frontier move commit
 * together under a row lock; and the unique index on (recurring_rule_id, recurrence_date) makes a
 * repeated insert a no-op regardless.
 */
@Injectable()
export class RecurringProcessorService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RecurringProcessorService.name);
  private dataSource!: DataSource;

  constructor(private readonly realtime: RealtimeEmitterService) {}

  async onModuleInit(): Promise<void> {
    // Two connections are enough: one holds the advisory lock, one processes rules in turn.
    this.dataSource = new DataSource({ ...createMigrationDataSource().options, extra: { max: 2 } });
    await this.dataSource.initialize();

    // createMigrationDataSource() falls back to DATABASE_URL when MIGRATION_DATABASE_URL isn't
    // set. In a two-role setup that's the RLS-bound runtime role, which sees no rows without an
    // app.current_user_id — every tick would find nothing due and quietly do nothing, forever.
    const [{ bypasses }] = await this.dataSource.query(BYPASSES_RLS_SQL);
    if (!bypasses) {
      await this.dataSource.destroy();
      throw new Error(
        'Recurring scheduler needs a connection that bypasses RLS (the schema owner) — set MIGRATION_DATABASE_URL',
      );
    }
  }

  onApplicationBootstrap(): void {
    // Catch up straight away after a restart instead of waiting for the next run. Not awaited, so
    // a slow first run doesn't hold up the app accepting requests.
    void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  // Often enough that a series' next occurrence shows up soon after its planned one lands; a run
  // with nothing due is a single query.
  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'recurring-occurrences' })
  async tick(): Promise<void> {
    const lockRunner = this.dataSource.createQueryRunner();
    try {
      await lockRunner.connect();
      const [{ locked }] = await lockRunner.query(LOCK_SQL);
      if (!locked) {
        this.logger.debug('Another tick holds the recurring lock, skipping');
        return;
      }
      try {
        const now = new Date();
        // Estimates first, so a series' next occurrence is estimated from a balance that already
        // holds what the one that just landed came to.
        await this.settleEstimates(now);
        await this.processDueRules(now);
      } finally {
        await lockRunner.query(UNLOCK_SQL);
      }
    } catch (error) {
      this.logger.error('Recurring tick failed', error instanceof Error ? error.stack : error);
    } finally {
      await lockRunner.release();
    }
  }

  private async settleEstimates(now: Date): Promise<void> {
    const due: { id: string }[] = await this.dataSource.query(DUE_ESTIMATES_SQL, [now]);

    let settled = 0;
    for (const { id } of due) {
      if (await this.settleEstimate(id)) {
        settled++;
      }
    }
    if (settled > 0) {
      this.logger.log(`Worked out ${settled} percentage amount(s) on their date`);
    }
  }

  // Each in its own transaction, like the rules below: one that fails is logged and skipped.
  private async settleEstimate(transactionId: string): Promise<boolean> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const [row]: { id: string; group_id: string; account_id: string; date: Date; percentage: string }[] =
        await runner.query(LOCK_ESTIMATE_SQL, [transactionId]);
      if (!row) {
        await runner.commitTransaction();
        return false;
      }
      const amount = await percentageAmount(
        runner.manager,
        { accountId: row.account_id, percentage: row.percentage, percentageBase: null },
        row.date,
        row.id,
      );
      const something = isPositiveMoney(amount);
      await runner.query(something ? SETTLE_SQL : SETTLE_TO_NOTHING_SQL, something ? [row.id, amount] : [row.id]);
      await runner.commitTransaction();

      this.realtime.emitToGroupNow(row.group_id, {
        resourceType: 'Transaction',
        resourceId: row.id,
        action: something ? 'updated' : 'deleted',
        groupId: row.group_id,
      });
      return true;
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      this.logger.error(`Percentage amount of transaction ${transactionId} failed`, error instanceof Error ? error.stack : error);
      return false;
    } finally {
      await runner.release();
    }
  }

  private async processDueRules(now: Date): Promise<void> {
    const due: { id: string }[] = await this.dataSource.query(DUE_RULES_SQL, [now]);

    let processed = 0;
    for (const { id } of due) {
      if (await this.processRule(id, now)) {
        processed++;
      }
    }
    if (processed > 0) {
      this.logger.log(`Materialized occurrences for ${processed} recurring rule(s)`);
    }
  }

  // Each rule in its own transaction: one that fails (say, its account was deleted in the
  // meantime) is logged and skipped without rolling back the rules processed before it.
  private async processRule(ruleId: string, now: Date): Promise<boolean> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // Re-read under a row lock rather than trust the candidate list: a request may have
      // edited, paused or deleted the rule since, and must not interleave with this write.
      const rule = await runner.manager
        .createQueryBuilder(RecurringRule, 'r')
        .setLock('pessimistic_write')
        .where('r.id = :ruleId', { ruleId })
        .andWhere('r.active = true')
        .getOne();

      const inserted = rule ? await materializeOccurrences(runner.manager, rule, now) : 0;
      await runner.commitTransaction();

      if (rule && inserted > 0) {
        this.realtime.emitToGroupNow(rule.groupId, {
          resourceType: 'RecurringRule',
          resourceId: rule.id,
          action: 'updated',
          groupId: rule.groupId,
        });
      }
      return inserted > 0;
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      this.logger.error(`Recurring rule ${ruleId} failed`, error instanceof Error ? error.stack : error);
      return false;
    } finally {
      await runner.release();
    }
  }
}
