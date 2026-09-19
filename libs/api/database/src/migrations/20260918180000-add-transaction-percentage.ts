import { TableCheck, TableColumn } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

const CHECK = 'chk_transaction_percentage';

// A transaction whose amount is a percentage of its account's balance — a card's monthly charge,
// say — keeps that percentage beside the amount, so editing it later starts from the percentage
// rather than from a figure that only happened to come out of it.
export const addTransactionPercentage: Migration = {
  name: '20260918180000-add-transaction-percentage',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumn(
      'transactions',
      new TableColumn({ name: 'percentage', type: 'numeric', precision: 7, scale: 4, isNullable: true }),
    );
    await queryRunner.createCheckConstraint(
      'transactions',
      new TableCheck({ name: CHECK, expression: 'percentage IS NULL OR (percentage > 0 AND percentage <= 100)' }),
    );
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropCheckConstraint('transactions', CHECK);
    await queryRunner.dropColumn('transactions', 'percentage');
  },
};
