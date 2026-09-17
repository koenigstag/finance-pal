import { TableColumn, TableForeignKey, TableIndex } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Recurring rules materialize their occurrences as ordinary transactions dated in the future,
// through the end of next calendar month. These columns tie each such row back to its rule.
const TRANSACTION_COLUMNS = [
  new TableColumn({ name: 'recurring_rule_id', type: 'uuid', isNullable: true }),
  // The occurrence's scheduled date. Unlike `date`, never edited: a user may move one
  // occurrence to another day, but it's still that same occurrence of the series.
  new TableColumn({ name: 'recurrence_date', type: 'timestamptz', isNullable: true }),
  // Set when a user edits one occurrence directly, so regenerating the series after a rule
  // change replaces only rows nobody touched.
  new TableColumn({ name: 'is_customized', type: 'boolean', default: false }),
];

export const addRecurringOccurrences: Migration = {
  name: '20260917120000-add-recurring-occurrences',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    // IANA zone name. "Every 1st of the month" only pins down an instant once a zone is known,
    // and it belongs to the obligation itself, not to whichever member happens to look at it.
    await queryRunner.addColumn('recurring_rules', new TableColumn({ name: 'timezone', type: 'text', default: "'UTC'" }));

    await queryRunner.addColumns('transactions', TRANSACTION_COLUMNS);

    // SET NULL, not CASCADE: rules are only ever soft-deleted by the app, and a hard delete must
    // never take the transactions that already happened with it.
    await queryRunner.createForeignKey(
      'transactions',
      new TableForeignKey({
        name: 'fk_transactions_recurring_rule',
        columnNames: ['recurring_rule_id'],
        referencedTableName: 'recurring_rules',
        referencedColumnNames: ['id'],
        onDelete: 'SET NULL',
      }),
    );

    // At most one row per occurrence of a series — the scheduler relies on this for idempotency
    // (INSERT ... ON CONFLICT DO NOTHING). Deliberately NOT filtered on deleted_at: a user
    // deleting a single occurrence ("skip this one") leaves a soft-deleted row that must keep
    // blocking that date from being generated again.
    await queryRunner.createIndex(
      'transactions',
      new TableIndex({
        name: 'uq_transactions_occurrence',
        columnNames: ['recurring_rule_id', 'recurrence_date'],
        isUnique: true,
        where: 'recurring_rule_id IS NOT NULL',
      }),
    );

    // Separate from check_group_consistency() rather than an extra branch in it: that function
    // is shared with recurring_rules, which has no recurring_rule_id column, so referencing
    // NEW.recurring_rule_id there would fail at runtime for every recurring_rules write.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION check_transaction_recurring_rule_group()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.recurring_rule_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM recurring_rules WHERE id = NEW.recurring_rule_id AND group_id = NEW.group_id
        ) THEN
          RAISE EXCEPTION 'recurring_rule_id % does not belong to group %', NEW.recurring_rule_id, NEW.group_id;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_transactions_recurring_rule_group
      BEFORE INSERT OR UPDATE OF recurring_rule_id, group_id ON transactions
      FOR EACH ROW EXECUTE FUNCTION check_transaction_recurring_rule_group()
    `);
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.query('DROP TRIGGER IF EXISTS trg_transactions_recurring_rule_group ON transactions');
    await queryRunner.query('DROP FUNCTION IF EXISTS check_transaction_recurring_rule_group()');
    await queryRunner.dropIndex('transactions', 'uq_transactions_occurrence');
    await queryRunner.dropForeignKey('transactions', 'fk_transactions_recurring_rule');
    await queryRunner.dropColumns(
      'transactions',
      TRANSACTION_COLUMNS.map((c) => c.name),
    );
    await queryRunner.dropColumn('recurring_rules', 'timezone');
  },
};
