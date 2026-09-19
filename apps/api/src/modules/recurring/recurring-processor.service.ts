import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { RecurringRule, createMigrationDataSource } from '@ft/api-database';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { reworkEstimates } from './balance-estimates';
import { materializeOccurrences, plannedOccurrence } from './occurrence-materializer';

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
 * Around that, it brings the amounts that come from a balance (a percentage of it, or rounding it)
 * and are still estimates in line with it (see reworkEstimates): one that has landed is worked out a
 * last time, from the balance on its date, and a planned one follows what its account now holds.
 * Requests do the same for the accounts they touch; this catches whatever changed otherwise, a
 * planned transaction landing among them.
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
        // Estimates first, so the occurrences a series catches up on are worked out from a balance
        // that holds what the one that just landed came to; and again after, for the planned
        // amounts the newly written occurrences come before.
        await this.reworkEstimates(now);
        await this.processDueRules(now);
        await this.reworkEstimates(now);
      } finally {
        await lockRunner.query(UNLOCK_SQL);
      }
    } catch (error) {
      this.logger.error('Recurring tick failed', error instanceof Error ? error.stack : error);
    } finally {
      await lockRunner.release();
    }
  }

  // All in one transaction, in date order across accounts: a transfer's amount moves the balance of
  // the account it goes to as well.
  private async reworkEstimates(now: Date): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const reworked = await reworkEstimates(runner.manager, null, now);
      await runner.commitTransaction();

      for (const { id, groupId, action } of reworked) {
        this.realtime.emitToGroupNow(groupId, { resourceType: 'Transaction', resourceId: id, action, groupId });
      }
      if (reworked.length > 0) {
        this.logger.log(`Worked out ${reworked.length} amount(s) from their balance again`);
      }
    } catch (error) {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
      this.logger.error('Working out amounts from their balance failed', error instanceof Error ? error.stack : error);
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
