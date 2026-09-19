import { TableCheck, TableColumn, TableIndex } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

const RULE_CHECKS = [
  { name: 'chk_recurring_percentage', expression: 'percentage IS NULL OR (percentage > 0 AND percentage <= 100)' },
  {
    name: 'chk_recurring_percentage_base',
    expression: 'percentage_base IS NULL OR (percentage IS NOT NULL AND percentage_base > 0)',
  },
] as const;

const AS_OF_CHECK = 'chk_transaction_percentage_as_of';
const PENDING_INDEX = 'idx_transactions_percentage_pending';

// A series can be a percentage too — of a base amount, or of its account's balance — the same pair
// a transaction carries. A percentage of the balance is worked out on each occurrence's date, so a
// transaction now also records when the balance it took was: percentage_as_of. Earlier than the
// transaction's date means the amount is still an estimate, which the scheduler works out again
// once the date comes; the partial index holds only those, so finding them stays cheap.
export const addPercentageToSeries: Migration = {
  name: '20260918210000-add-percentage-to-series',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumns('recurring_rules', [
      new TableColumn({ name: 'percentage', type: 'numeric', precision: 7, scale: 4, isNullable: true }),
      new TableColumn({ name: 'percentage_base', type: 'numeric', precision: 14, scale: 2, isNullable: true }),
    ]);
    for (const check of RULE_CHECKS) {
      await queryRunner.createCheckConstraint('recurring_rules', new TableCheck(check));
    }

    await queryRunner.addColumn(
      'transactions',
      new TableColumn({ name: 'percentage_as_of', type: 'timestamptz', isNullable: true }),
    );
    await queryRunner.createCheckConstraint(
      'transactions',
      new TableCheck({
        name: AS_OF_CHECK,
        expression: 'percentage_as_of IS NULL OR (percentage IS NOT NULL AND percentage_base IS NULL)',
      }),
    );
    await queryRunner.createIndex(
      'transactions',
      new TableIndex({
        name: PENDING_INDEX,
        columnNames: ['date'],
        where: 'percentage_as_of < date AND deleted_at IS NULL',
      }),
    );
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropIndex('transactions', PENDING_INDEX);
    await queryRunner.dropCheckConstraint('transactions', AS_OF_CHECK);
    await queryRunner.dropColumn('transactions', 'percentage_as_of');
    for (const check of RULE_CHECKS) {
      await queryRunner.dropCheckConstraint('recurring_rules', check.name);
    }
    await queryRunner.dropColumns('recurring_rules', ['percentage', 'percentage_base']);
  },
};
