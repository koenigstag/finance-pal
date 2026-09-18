import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// A series used to write its occurrences ahead through the end of next month; now it keeps a
// single one ahead of now, and writes the next when that one's date passes. What the old scheme
// wrote ahead and nobody touched goes here, and every series' frontier comes back to now, so the
// scheduler's next run writes each one's next occurrence afresh. Dates a user deleted stay blocked,
// and occurrences a user edited stay as they are.
export const keepOnePlannedOccurrence: Migration = {
  name: '20260918200000-keep-one-planned-occurrence',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.query(`
      DELETE FROM transactions
      WHERE recurring_rule_id IS NOT NULL
        AND recurrence_date > now()
        AND is_customized = false
        AND deleted_at IS NULL
    `);
    await queryRunner.query(`UPDATE recurring_rules SET next_run_date = LEAST(next_run_date, now()) WHERE deleted_at IS NULL`);
  },

  async down() {
    // Nothing to put back: the scheduler of the version rolled back to writes its horizon again on
    // its first run.
  },
};
