import { TableCheck, TableColumn, TableIndex } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// When a transfer's received amount was last worked out from an exchange rate. Set, it's the
// rate's to follow: before the transfer's date an estimate at the latest rate, and on the day, at
// that day's rate, for good. Null keeps meaning what destAmount always meant: the figure the user
// typed, which no rate overrides. Existing rows are all typed, so nothing is backfilled.
export const addTransactionDestAmountAsOf: Migration = {
  name: '20260919170000-add-transaction-dest-amount-as-of',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumn(
      'transactions',
      new TableColumn({ name: 'dest_amount_as_of', type: 'timestamptz', isNullable: true }),
    );
    await queryRunner.createCheckConstraint(
      'transactions',
      new TableCheck({
        name: 'chk_transaction_dest_amount_as_of',
        expression: 'dest_amount_as_of IS NULL OR to_account_id IS NOT NULL',
      }),
    );
    // What the scheduler looks for on every tick, kept small: only the estimates still pending.
    await queryRunner.createIndex(
      'transactions',
      new TableIndex({
        name: 'idx_transactions_dest_rate_pending',
        columnNames: ['date'],
        where: 'dest_amount_as_of < date AND deleted_at IS NULL',
      }),
    );
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropIndex('transactions', 'idx_transactions_dest_rate_pending');
    await queryRunner.dropCheckConstraint('transactions', 'chk_transaction_dest_amount_as_of');
    await queryRunner.dropColumn('transactions', 'dest_amount_as_of');
  },
};
