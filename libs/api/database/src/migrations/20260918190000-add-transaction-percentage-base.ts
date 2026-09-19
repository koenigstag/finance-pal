import { TableCheck, TableColumn } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

const CHECK = 'chk_transaction_percentage_base';

// The amount a transaction's percentage is of, when that isn't the account's balance — the income
// a tax is a share of, say. It's only ever there beside the percentage it's the base of.
export const addTransactionPercentageBase: Migration = {
  name: '20260918190000-add-transaction-percentage-base',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumn(
      'transactions',
      new TableColumn({ name: 'percentage_base', type: 'numeric', precision: 14, scale: 2, isNullable: true }),
    );
    await queryRunner.createCheckConstraint(
      'transactions',
      new TableCheck({
        name: CHECK,
        expression: 'percentage_base IS NULL OR (percentage IS NOT NULL AND percentage_base > 0)',
      }),
    );
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropCheckConstraint('transactions', CHECK);
    await queryRunner.dropColumn('transactions', 'percentage_base');
  },
};
