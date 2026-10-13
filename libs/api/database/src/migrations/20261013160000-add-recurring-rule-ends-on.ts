import { TableColumn } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// When a series ends: the last calendar day, in its own time zone, that a payment may fall on. A
// series ending "after 12 payments" keeps the date of its twelfth: a count would start over each
// time its next date moved, while the date stays the commitment it was. Null runs on until paused
// or deleted, as every series did before.
export const addRecurringRuleEndsOn: Migration = {
  name: '20261013160000-add-recurring-rule-ends-on',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumn('recurring_rules', new TableColumn({ name: 'ends_on', type: 'date', isNullable: true }));
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropColumn('recurring_rules', 'ends_on');
  },
};
