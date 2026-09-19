import { TableCheck, TableColumn } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

const ROUNDING_CHECKS = [
  { table: 'transactions', name: 'chk_transaction_round_balance_to' },
  { table: 'recurring_rules', name: 'chk_recurring_round_balance_to' },
] as const;
const ROUNDING = 'round_balance_to IS NULL OR (round_balance_to IN (1, 10, 100, 1000) AND percentage IS NULL)';

const AS_OF_CHECK = 'chk_transaction_percentage_as_of';
const AS_OF_BEFORE = 'percentage_as_of IS NULL OR (percentage IS NOT NULL AND percentage_base IS NULL)';
const AS_OF_AFTER = `${AS_OF_BEFORE} OR round_balance_to IS NOT NULL`;

// "Round the balance": an amount worked out as whatever leaves the account's balance on a multiple
// of 1, 10, 100 or 1000 once the transaction goes through. A transaction and a series take it the
// way they take a percentage, and one or the other, never both. It comes from the balance as a
// percentage of it does, so it's an estimate the same way until its date: percentage_as_of serves
// both. The column keeps its name rather than be renamed under the APIs of other branches sharing
// a database with this one, which still read it.
export const addBalanceRounding: Migration = {
  name: '20260919120000-add-balance-rounding',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    for (const { table, name } of ROUNDING_CHECKS) {
      await queryRunner.addColumn(table, new TableColumn({ name: 'round_balance_to', type: 'smallint', isNullable: true }));
      await queryRunner.createCheckConstraint(table, new TableCheck({ name, expression: ROUNDING }));
    }
    await queryRunner.dropCheckConstraint('transactions', AS_OF_CHECK);
    await queryRunner.createCheckConstraint('transactions', new TableCheck({ name: AS_OF_CHECK, expression: AS_OF_AFTER }));
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    // Back to percentages alone: a rounded amount stays as the figure it came to.
    await queryRunner.query('UPDATE transactions SET percentage_as_of = NULL WHERE round_balance_to IS NOT NULL');
    await queryRunner.dropCheckConstraint('transactions', AS_OF_CHECK);
    await queryRunner.createCheckConstraint('transactions', new TableCheck({ name: AS_OF_CHECK, expression: AS_OF_BEFORE }));
    for (const { table, name } of ROUNDING_CHECKS) {
      await queryRunner.dropCheckConstraint(table, name);
      await queryRunner.dropColumn(table, 'round_balance_to');
    }
  },
};
