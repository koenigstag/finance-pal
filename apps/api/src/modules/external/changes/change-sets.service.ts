import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, QueryFailedError, Repository } from 'typeorm';
import { ChangeSet } from '@ft/api-database';
import { inSavepoint } from '../../_core/database/after-commit';
import type { RequestApiKey } from '../../_core/authn/request-user';
import { ExchangeRatesService } from '../../ledger/exchange-rates/exchange-rates.service';
import { RealtimeEmitterService } from '../../realtime/realtime-emitter.service';
import { reworkEstimates } from '../../recurring/balance-estimates';
import { reworkRateEstimates } from '../../recurring/rate-estimates';
import {
  KEPT_BY_TRIGGER,
  REALTIME_TYPE,
  collapse,
  isRecordedTable,
  touchedKey,
  undoBlockers,
  undoOrder,
  type RecordedWrite,
  type Row,
  type TouchedRow,
  type UndoBlocker,
} from './change-rows';

/** How long a change can be undone for; older ones are forgotten. */
export const UNDO_DAYS = 30;

export interface ChangeStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface Recorded<T> {
  result: T;
  // Null when nothing was changed, or nothing kept (a dry run).
  changeId: string | null;
  touched: TouchedRow[];
}

/** A change that can't be undone as it stands, and the rows that stand in the way. */
export class UndoBlockedError extends Error {
  constructor(readonly blockers: UndoBlocker[]) {
    super('The change can’t be undone as things are now');
  }
}

/**
 * Changes another app makes through an API key, kept so they can be undone: each runs in a
 * savepoint of the request's transaction with app.change_set_id set, which has a trigger record
 * every row it writes, as it was and as it became (see 20261013180000-create-change-sets). A dry
 * run is made for real and rolled back, so what it reports is exactly what the change would do.
 *
 * Undoing puts the rows back as the change found them, all of them or none: not when any was
 * changed since, nor when one was a planned transaction that has happened since. Changes are the
 * key owner's own: no one else lists or undoes them.
 */
@Injectable()
export class ChangeSetsService {
  constructor(
    @InjectRepository(ChangeSet) private readonly changeSets: Repository<ChangeSet>,
    private readonly rates: ExchangeRatesService,
    private readonly realtime: RealtimeEmitterService,
  ) {}

  /**
   * Runs `run` as one change: kept, with what it touched recorded, or with `dryRun` rolled back once
   * it's done. A throw rolls it back too, and is thrown on.
   */
  async record<T>(
    apiKey: RequestApiKey,
    request: { steps: ChangeStep[]; description?: string | null; dryRun?: boolean },
    run: () => Promise<T>,
  ): Promise<Recorded<T>> {
    return inSavepoint(
      this.changeSets.manager,
      async () => {
        const changeSet = await this.changeSets.save(
          this.changeSets.create({
            groupId: apiKey.groupId,
            createdBy: apiKey.userId,
            apiKeyId: apiKey.id,
            source: apiKey.name,
            description: request.description?.trim() || null,
            steps: request.steps,
            undoneAt: null,
          }),
        );
        await this.recordInto(changeSet.id);
        const result = await run();
        await this.recordInto('');
        const touched = collapse(await this.writesOf(changeSet.id));
        if (touched.length === 0) {
          // Nothing to undo: no change to list either.
          await this.changeSets.delete({ id: changeSet.id });
        } else if (!request.dryRun) {
          await this.forgetOld(apiKey.groupId);
        }
        return { result, changeId: touched.length > 0 && !request.dryRun ? changeSet.id : null, touched };
      },
      () => !request.dryRun,
    );
  }

  /** The key owner's changes in its group from the days they can be undone in, newest first. */
  async list(apiKey: RequestApiKey, limit: number): Promise<{ changeSet: ChangeSet; rows: number }[]> {
    const changeSets = await this.changeSets.find({
      where: { groupId: apiKey.groupId, createdBy: apiKey.userId, createdAt: MoreThan(undoableSince()) },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    if (changeSets.length === 0) {
      return [];
    }
    const counts: { change_set_id: string; rows: string }[] = await this.changeSets.query(
      'SELECT change_set_id, count(*) AS rows FROM change_set_rows WHERE change_set_id = ANY($1) GROUP BY change_set_id',
      [changeSets.map((changeSet) => changeSet.id)],
    );
    const byId = new Map(counts.map((count) => [count.change_set_id, Number(count.rows)]));
    return changeSets.map((changeSet) => ({ changeSet, rows: byId.get(changeSet.id) ?? 0 }));
  }

  /**
   * Puts back what a change did, all of it or nothing: refused with UndoBlockedError when a row it
   * touched was changed since, or was planned then and has happened since. `mayUndo` says whether
   * the key may still use each of the change's tools; undoing takes what doing did. With `dryRun`,
   * it's done and rolled back, to show what it would do.
   */
  async undo(
    apiKey: RequestApiKey,
    changeId: string,
    options: { dryRun: boolean; mayUndo: (tool: string) => boolean },
  ): Promise<{ changeSet: ChangeSet; touched: TouchedRow[] }> {
    const changeSet = await this.changeSets.findOneBy({ id: changeId, groupId: apiKey.groupId, createdBy: apiKey.userId });
    if (!changeSet) {
      throw new NotFoundException('There is no change with that id: list_changes shows the ones that can be undone');
    }
    if (changeSet.undoneAt) {
      throw new BadRequestException(`That change was undone already, at ${changeSet.undoneAt.toISOString()}`);
    }
    if (changeSet.createdAt <= undoableSince()) {
      throw new BadRequestException(`Changes can only be undone for ${UNDO_DAYS} days`);
    }
    const tools = [...new Set(changeSet.steps.map((step) => step.tool))].filter((tool) => !options.mayUndo(tool));
    if (tools.length > 0) {
      throw new BadRequestException(`Undoing it takes the permissions its tools needed, which this key doesn't have now: ${tools.join(', ')}`);
    }

    const touched = collapse(await this.writesOf(changeSet.id));
    const now = new Date();
    const blockers = undoBlockers(touched, await this.currentRows(touched), changeSet.createdAt, now);
    if (blockers.length > 0) {
      throw new UndoBlockedError(blockers);
    }

    try {
      return await inSavepoint(
        this.changeSets.manager,
        async () => {
          for (const row of undoOrder(touched)) {
            await this.changeSets.query('SELECT undo_change_row($1::regclass, $2::uuid, $3::jsonb, $4::text[])', [
              row.table,
              row.rowId,
              row.before === null ? null : JSON.stringify(row.before),
              KEPT_BY_TRIGGER[row.table] ?? [],
            ]);
          }
          await this.changeSets.update({ id: changeSet.id }, { undoneAt: now });
          await this.settle(apiKey.groupId, touched, now);
          return { changeSet, touched };
        },
        () => !options.dryRun,
      );
    } catch (error) {
      // What came since leans on what the change made (a transaction on an account it added), or
      // took the place of what it removed (a budget line set again for the same month).
      const code = error instanceof QueryFailedError ? (error.driverError as { code?: string }).code : undefined;
      if (code === '23503' || code === '23505') {
        throw new BadRequestException(
          code === '23503'
            ? 'Something added since depends on what the change made, so it can’t be undone; remove that first'
            : 'Something added since has taken the place of what the change removed, so it can’t be undone; remove that first',
        );
      }
      throw error;
    }
  }

  // Sets, or with '' clears, the change the trigger records into, for the rest of the transaction.
  private async recordInto(changeId: string): Promise<void> {
    await this.changeSets.query(`SELECT set_config('app.change_set_id', $1, true)`, [changeId]);
  }

  private async writesOf(changeId: string): Promise<RecordedWrite[]> {
    const rows: { id: string; table_name: string; row_id: string; op: RecordedWrite['op']; old_row: Row | null; new_row: Row | null }[] =
      await this.changeSets.query(
        'SELECT id, table_name, row_id, op, old_row, new_row FROM change_set_rows WHERE change_set_id = $1 ORDER BY id',
        [changeId],
      );
    return rows.flatMap((row) =>
      isRecordedTable(row.table_name)
        ? [{ seq: Number(row.id), table: row.table_name, rowId: row.row_id, op: row.op, oldRow: row.old_row, newRow: row.new_row }]
        : [],
    );
  }

  // Each touched row as it is now, deleted ones included; missing when it's gone altogether.
  private async currentRows(touched: TouchedRow[]): Promise<Map<string, Row | null>> {
    const current = new Map<string, Row | null>();
    const byTable = new Map<string, string[]>();
    for (const row of touched) {
      byTable.set(row.table, [...(byTable.get(row.table) ?? []), row.rowId]);
    }
    for (const [table, ids] of byTable) {
      // The table name is one of RECORDED_TABLES, never input.
      const rows: { id: string; row: Row }[] = await this.changeSets.query(
        `SELECT t.id, to_jsonb(t) AS row FROM ${table} t WHERE t.id = ANY($1)`,
        [ids],
      );
      for (const { id, row } of rows) {
        current.set(touchedKey(table, id), row);
      }
    }
    return current;
  }

  /**
   * After rows are put back: the amounts the app works out from a balance or at a rate follow the
   * balances as they now are, and the group's devices hear of each kind of thing that changed —
   * once each, however many rows, as a reorder or a series is announced.
   */
  private async settle(groupId: string, touched: TouchedRow[], now: Date): Promise<void> {
    const accountIds = new Set<string>();
    for (const row of touched) {
      for (const image of [row.before, row.after]) {
        for (const column of ['account_id', 'to_account_id']) {
          const id = image?.[column];
          if (typeof id === 'string' && (row.table === 'transactions' || row.table === 'recurring_rules')) {
            accountIds.add(id);
          }
        }
      }
    }
    if (accountIds.size > 0) {
      const ids = [...accountIds];
      await reworkEstimates(this.changeSets.manager, ids, now);
      await reworkRateEstimates(this.changeSets.manager, this.rates.lookup, ids, now);
    }
    const announced = new Set<string>();
    for (const row of touched) {
      const resourceType = REALTIME_TYPE[row.table];
      if (!announced.has(resourceType)) {
        announced.add(resourceType);
        this.realtime.emitToGroup(groupId, { resourceType, resourceId: row.rowId, action: 'updated', groupId });
      }
    }
  }

  // Changes past undoing are forgotten as new ones come in, and their rows with them.
  private async forgetOld(groupId: string): Promise<void> {
    await this.changeSets.query('DELETE FROM change_sets WHERE group_id = $1 AND created_at <= $2', [groupId, undoableSince()]);
  }
}

function undoableSince(): Date {
  return new Date(Date.now() - UNDO_DAYS * 24 * 60 * 60 * 1000);
}
