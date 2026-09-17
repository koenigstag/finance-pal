import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, LessThanOrEqual } from 'typeorm';
import { RecurringRule, createMigrationDataSource } from '@ft/api-database';
import { RealtimeEmitterService } from '../realtime/realtime-emitter.service';
import { materializeOccurrences } from './occurrence-materializer';
import { horizonEnd } from './recurrence-dates';

// Session-level advisory lock serializing ticks across every instance of the API. hashtext()
// turns a readable name into the lock key, so nothing else has to agree on a magic number.
const LOCK_SQL = `SELECT pg_try_advisory_lock(hashtext('ft:recurring-occurrences')) AS locked`;
const UNLOCK_SQL = `SELECT pg_advisory_unlock(hashtext('ft:recurring-occurrences'))`;

// The horizon ends with next calendar month, at most ~62 days out in any zone. Rules whose
// frontier is further than this can't be due; the exact per-zone check happens per rule.
const CANDIDATE_WINDOW_MS = 63 * 24 * 60 * 60 * 1000;

// Can this connection see and write every group's rules despite RLS? Only a table's owner, a
// superuser or a BYPASSRLS role can.
const BYPASSES_RLS_SQL = `
  SELECT (r.rolsuper OR r.rolbypassrls OR t.tableowner = current_user) AS bypasses
  FROM pg_roles r, pg_tables t
  WHERE r.rolname = current_user AND t.schemaname = 'public' AND t.tablename = 'recurring_rules'
`;

/**
 * Keeps every active rule's occurrences materialized through the end of next month as time moves
 * on — mostly extending the horizon when a month rolls over, and filling it right after downtime.
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
    // Fill horizons straight away after a restart instead of waiting up to an hour. Not awaited,
    // so a slow first run doesn't hold up the app accepting requests.
    void this.tick();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource?.isInitialized) {
      await this.dataSource.destroy();
    }
  }

  @Cron(CronExpression.EVERY_HOUR, { name: 'recurring-occurrences' })
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
        await this.processDueRules(new Date());
      } finally {
        await lockRunner.query(UNLOCK_SQL);
      }
    } catch (error) {
      this.logger.error('Recurring tick failed', error instanceof Error ? error.stack : error);
    } finally {
      await lockRunner.release();
    }
  }

  private async processDueRules(now: Date): Promise<void> {
    const candidates = await this.dataSource.getRepository(RecurringRule).find({
      select: { id: true, nextRunDate: true, timezone: true },
      where: { active: true, nextRunDate: LessThanOrEqual(new Date(now.getTime() + CANDIDATE_WINDOW_MS)) },
    });

    let processed = 0;
    for (const candidate of candidates) {
      if (candidate.nextRunDate.getTime() > horizonEnd(now, candidate.timezone).getTime()) {
        continue;
      }
      if (await this.processRule(candidate.id, now)) {
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
