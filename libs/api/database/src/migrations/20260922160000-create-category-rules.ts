import { Table, TableForeignKey } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// A group's category rules: a piece of text, and the category a transaction goes in when the
// shop's name in a bank notification contains it ("Uklon" → Taxi). The API reads them when it
// records a forwarded notification.
//
// The policies are the ones every group-scoped table has: any member reads, only a non-viewer in
// a group that isn't archived writes.
async function up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.createTable(
    new Table({
      name: 'category_rules',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'group_id', type: 'uuid' },
        { name: 'pattern', type: 'text' },
        // A top-level category or a subcategory; a subcategory brings its parent along.
        { name: 'category_id', type: 'uuid' },
        { name: 'created_by', type: 'uuid' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', default: 'now()' },
      ],
      checks: [{ name: 'chk_category_rules_pattern', expression: 'length(btrim(pattern)) BETWEEN 1 AND 120' }],
    }),
    true,
  );

  await queryRunner.createForeignKey(
    'category_rules',
    new TableForeignKey({ columnNames: ['group_id'], referencedTableName: 'groups', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );
  // Categories are deleted softly, and CategoriesService deletes their rules along with them; the
  // cascade is for the rows a deleted group takes with it.
  await queryRunner.createForeignKey(
    'category_rules',
    new TableForeignKey({
      columnNames: ['category_id'],
      referencedTableName: 'categories',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    }),
  );
  await queryRunner.createForeignKey(
    'category_rules',
    new TableForeignKey({ columnNames: ['created_by'], referencedTableName: 'users', referencedColumnNames: ['id'] }),
  );

  // One rule per text in a group, whatever its case: a second one could only ever lose to the
  // first. It also serves the lookups by group, as its leading column.
  await queryRunner.query('CREATE UNIQUE INDEX uq_category_rules_pattern ON category_rules (group_id, lower(pattern))');

  await queryRunner.query(`
    CREATE TRIGGER trg_category_rules_updated
    BEFORE UPDATE ON category_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  await queryRunner.query('ALTER TABLE category_rules ENABLE ROW LEVEL SECURITY');
  await queryRunner.query('CREATE POLICY category_rules_select ON category_rules FOR SELECT USING (is_group_member(group_id))');
  await queryRunner.query('CREATE POLICY category_rules_insert ON category_rules FOR INSERT WITH CHECK (can_write_group(group_id))');
  await queryRunner.query(`
    CREATE POLICY category_rules_update ON category_rules FOR UPDATE
    USING (can_write_group(group_id)) WITH CHECK (can_write_group(group_id))
  `);
  await queryRunner.query('CREATE POLICY category_rules_delete ON category_rules FOR DELETE USING (can_write_group(group_id))');
}

async function down(queryRunner: QueryRunner): Promise<void> {
  // Takes its policies, trigger, indexes and foreign keys along.
  await queryRunner.dropTable('category_rules', true);
}

export const createCategoryRules: Migration = {
  name: '20260922160000-create-category-rules',

  async up({ context: queryRunner }) {
    await up(queryRunner);
  },

  async down({ context: queryRunner }) {
    await down(queryRunner);
  },
};
