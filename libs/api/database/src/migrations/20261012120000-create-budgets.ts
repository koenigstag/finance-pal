import { Table, TableForeignKey } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// A group's budget: for one month, how much is meant to go to a top-level category (spent from an
// expense one, received into an income one) or into a debt or savings account. Each month is set
// on its own — nothing carries over into the next.
//
// The policies are the ones every group-scoped table has: any member reads, only a non-viewer in
// a group that isn't archived writes.
async function up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.createTable(
    new Table({
      name: 'budgets',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'group_id', type: 'uuid' },
        // The first day of the month the amount is for.
        { name: 'month', type: 'date' },
        // Exactly one of the two.
        { name: 'category_id', type: 'uuid', isNullable: true },
        { name: 'account_id', type: 'uuid', isNullable: true },
        { name: 'amount', type: 'numeric', precision: 14, scale: 2 },
        // The account's own for an account; for a category, the main currency of whoever set it.
        { name: 'currency_id', type: 'smallint' },
        { name: 'created_by', type: 'uuid' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', default: 'now()' },
      ],
      checks: [
        { name: 'chk_budgets_month', expression: "month = date_trunc('month', month)::date" },
        { name: 'chk_budgets_target', expression: 'num_nonnulls(category_id, account_id) = 1' },
        { name: 'chk_budgets_amount', expression: 'amount > 0' },
      ],
    }),
    true,
  );

  await queryRunner.createForeignKey(
    'budgets',
    new TableForeignKey({ columnNames: ['group_id'], referencedTableName: 'groups', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );
  // Categories and accounts are deleted softly, and their services delete the budget lines along
  // with them; the cascades are for the rows a deleted group takes with it.
  await queryRunner.createForeignKey(
    'budgets',
    new TableForeignKey({
      columnNames: ['category_id'],
      referencedTableName: 'categories',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    }),
  );
  await queryRunner.createForeignKey(
    'budgets',
    new TableForeignKey({
      columnNames: ['account_id'],
      referencedTableName: 'accounts',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    }),
  );
  await queryRunner.createForeignKey(
    'budgets',
    new TableForeignKey({ columnNames: ['currency_id'], referencedTableName: 'currencies', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey(
    'budgets',
    new TableForeignKey({ columnNames: ['created_by'], referencedTableName: 'users', referencedColumnNames: ['id'] }),
  );

  // One amount per category, or per account, in a month. Their leading columns also serve the
  // month's lookup.
  await queryRunner.query(
    'CREATE UNIQUE INDEX uq_budgets_category ON budgets (group_id, month, category_id) WHERE category_id IS NOT NULL',
  );
  await queryRunner.query(
    'CREATE UNIQUE INDEX uq_budgets_account ON budgets (group_id, month, account_id) WHERE account_id IS NOT NULL',
  );

  await queryRunner.query(`
    CREATE TRIGGER trg_budgets_updated
    BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  await queryRunner.query('ALTER TABLE budgets ENABLE ROW LEVEL SECURITY');
  await queryRunner.query('CREATE POLICY budgets_select ON budgets FOR SELECT USING (is_group_member(group_id))');
  await queryRunner.query('CREATE POLICY budgets_insert ON budgets FOR INSERT WITH CHECK (can_write_group(group_id))');
  await queryRunner.query(`
    CREATE POLICY budgets_update ON budgets FOR UPDATE
    USING (can_write_group(group_id)) WITH CHECK (can_write_group(group_id))
  `);
  await queryRunner.query('CREATE POLICY budgets_delete ON budgets FOR DELETE USING (can_write_group(group_id))');
}

async function down(queryRunner: QueryRunner): Promise<void> {
  // Takes its policies, trigger, indexes and foreign keys along.
  await queryRunner.dropTable('budgets', true);
}

export const createBudgets: Migration = {
  name: '20261012120000-create-budgets',

  async up({ context: queryRunner }) {
    await up(queryRunner);
  },

  async down({ context: queryRunner }) {
    await down(queryRunner);
  },
};
