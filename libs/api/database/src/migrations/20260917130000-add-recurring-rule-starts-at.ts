import { TableColumn } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// The anchor every occurrence of a rule is computed from: occurrence k = starts_at + k·interval.
// Advancing from the previous occurrence instead drifts on month ends and never recovers —
// Jan 31 → Feb 28 → Mar 28 → Apr 28 — while anchoring gives Jan 31 → Feb 28 → Mar 31 → Apr 30.
export const addRecurringRuleStartsAt: Migration = {
  name: '20260917130000-add-recurring-rule-starts-at',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumn('recurring_rules', new TableColumn({ name: 'starts_at', type: 'timestamptz', isNullable: true }));
    // next_run_date is the best available anchor for any rule that predates this column.
    await queryRunner.query('UPDATE recurring_rules SET starts_at = next_run_date');
    await queryRunner.query('ALTER TABLE recurring_rules ALTER COLUMN starts_at SET NOT NULL');
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropColumn('recurring_rules', 'starts_at');
  },
};
