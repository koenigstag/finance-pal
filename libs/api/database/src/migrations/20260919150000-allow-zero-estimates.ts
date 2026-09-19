import { TableCheck } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

const TRANSACTION_CHECK = 'chk_transaction_amount_positive';
const TRANSACTION_BEFORE = 'amount > 0 AND (dest_amount IS NULL OR dest_amount > 0)';
// IS NOT NULL spelled out: a check passes on NULL, and a missing percentage_as_of mustn't let a
// zero amount through.
const TRANSACTION_AFTER =
  '(amount > 0 OR (amount = 0 AND percentage_as_of IS NOT NULL AND percentage_as_of < date)) AND (dest_amount IS NULL OR dest_amount > 0)';

const RULE_CHECK = 'chk_recurring_amount_positive';
const RULE_BEFORE = 'amount > 0';
const RULE_AFTER =
  'amount > 0 OR (amount = 0 AND ((percentage IS NOT NULL AND percentage_base IS NULL) OR round_balance_to IS NOT NULL))';

// A planned amount from the balance — a percentage of it, or a rounding of it — is only what it
// comes to as things stand, and that may be nothing for now: a balance on a round figure already,
// or an empty one. Such an estimate may be zero, as may a series' own amount when it's from the
// balance; the date it's worked out a last time still drops one that comes to nothing. Anything
// recorded still moves money.
export const allowZeroEstimates: Migration = {
  name: '20260919150000-allow-zero-estimates',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropCheckConstraint('transactions', TRANSACTION_CHECK);
    await queryRunner.createCheckConstraint('transactions', new TableCheck({ name: TRANSACTION_CHECK, expression: TRANSACTION_AFTER }));
    await queryRunner.dropCheckConstraint('recurring_rules', RULE_CHECK);
    await queryRunner.createCheckConstraint('recurring_rules', new TableCheck({ name: RULE_CHECK, expression: RULE_AFTER }));
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    // A cent stands in for nothing, which the old checks refuse.
    await queryRunner.query('UPDATE transactions SET amount = 0.01 WHERE amount = 0');
    await queryRunner.query('UPDATE recurring_rules SET amount = 0.01 WHERE amount = 0');
    await queryRunner.dropCheckConstraint('transactions', TRANSACTION_CHECK);
    await queryRunner.createCheckConstraint('transactions', new TableCheck({ name: TRANSACTION_CHECK, expression: TRANSACTION_BEFORE }));
    await queryRunner.dropCheckConstraint('recurring_rules', RULE_CHECK);
    await queryRunner.createCheckConstraint('recurring_rules', new TableCheck({ name: RULE_CHECK, expression: RULE_BEFORE }));
  },
};
