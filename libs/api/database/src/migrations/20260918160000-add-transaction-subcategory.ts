import { TableCheck, TableColumn, TableForeignKey, TableIndex } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Both tables carry a transaction's category, and check_group_consistency() serves them both, so
// the new column goes on each of them before the function starts reading it.
const TABLES = ['transactions', 'recurring_rules'] as const;

const CHECKS = [
  { table: 'transactions', name: 'chk_transaction_subcategory' },
  { table: 'recurring_rules', name: 'chk_recurring_subcategory' },
] as const;

// check_group_consistency() as the domain schema created it, optionally with the subcategory
// held to the same rule as the category: it belongs to the row's group.
function groupConsistencyFunction(withSubcategory: boolean): string {
  const subcategoryCheck = withSubcategory
    ? `
      IF NEW.subcategory_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM categories WHERE id = NEW.subcategory_id AND group_id = NEW.group_id
      ) THEN
        RAISE EXCEPTION 'subcategory_id % does not belong to group %', NEW.subcategory_id, NEW.group_id;
      END IF;
`
    : '';
  return `
    CREATE OR REPLACE FUNCTION check_group_consistency()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.account_id AND group_id = NEW.group_id
      ) THEN
        RAISE EXCEPTION 'account_id % does not belong to group %', NEW.account_id, NEW.group_id;
      END IF;

      IF NEW.to_account_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounts WHERE id = NEW.to_account_id AND group_id = NEW.group_id
      ) THEN
        RAISE EXCEPTION 'to_account_id % does not belong to group %', NEW.to_account_id, NEW.group_id;
      END IF;

      IF NEW.category_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM categories WHERE id = NEW.category_id AND group_id = NEW.group_id
      ) THEN
        RAISE EXCEPTION 'category_id % does not belong to group %', NEW.category_id, NEW.group_id;
      END IF;
${subcategoryCheck}
      RETURN NEW;
    END;
    $$
  `;
}

// A transaction names its category and, apart from it, an optional subcategory of it: everything
// filed under a category is then found by category_id alone, subcategories included, and the
// subcategory is a finer label on top. Until now category_id held whichever of the two was picked,
// so rows filed under a subcategory move to the new shape here — and back again on the way down.
export const addTransactionSubcategory: Migration = {
  name: '20260918160000-add-transaction-subcategory',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    for (const table of TABLES) {
      await queryRunner.addColumn(table, new TableColumn({ name: 'subcategory_id', type: 'uuid', isNullable: true }));
      await queryRunner.createForeignKey(
        table,
        new TableForeignKey({ columnNames: ['subcategory_id'], referencedTableName: 'categories', referencedColumnNames: ['id'] }),
      );
      await queryRunner.query(`
        UPDATE ${table} AS row SET category_id = category.parent_id, subcategory_id = category.id
        FROM categories AS category
        WHERE category.id = row.category_id AND category.parent_id IS NOT NULL
      `);
    }
    // A subcategory is only ever a finer label on a category, so it never stands without one —
    // which also keeps it off transfers, whose category_id chk_*_sides already requires be null.
    for (const { table, name } of CHECKS) {
      await queryRunner.createCheckConstraint(
        table,
        new TableCheck({ name, expression: 'subcategory_id IS NULL OR category_id IS NOT NULL' }),
      );
    }
    await queryRunner.createIndex(
      'transactions',
      new TableIndex({ name: 'idx_transactions_subcategory', columnNames: ['subcategory_id'], where: 'deleted_at IS NULL' }),
    );
    await queryRunner.query(groupConsistencyFunction(true));
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.query(groupConsistencyFunction(false));
    await queryRunner.dropIndex('transactions', 'idx_transactions_subcategory');
    for (const { table, name } of CHECKS) {
      await queryRunner.dropCheckConstraint(table, name);
    }
    for (const table of TABLES) {
      await queryRunner.query(`UPDATE ${table} SET category_id = subcategory_id WHERE subcategory_id IS NOT NULL`);
      await queryRunner.dropColumn(table, 'subcategory_id');
    }
  },
};
