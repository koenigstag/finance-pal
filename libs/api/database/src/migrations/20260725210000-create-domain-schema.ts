import { Table, TableCheck, TableForeignKey, TableIndex, TableUnique } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

async function createTables(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.createTable(
    new Table({
      name: 'currencies',
      columns: [
        { name: 'id', type: 'smallint', isPrimary: true },
        { name: 'code', type: 'text', isUnique: true },
        { name: 'name', type: 'text' },
        { name: 'symbol', type: 'text', isNullable: true },
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'groups',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'name', type: 'text' },
        { name: 'owner_id', type: 'uuid' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        { name: 'archived_at', type: 'timestamptz', isNullable: true },
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'group_members',
      columns: [
        { name: 'group_id', type: 'uuid', isPrimary: true },
        { name: 'user_id', type: 'uuid', isPrimary: true },
        { name: 'role', type: 'enum', enum: ['owner', 'admin', 'member', 'viewer'], enumName: 'member_role', default: "'member'" },
        { name: 'joined_at', type: 'timestamptz', default: 'now()' },
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'profiles',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true },
        { name: 'email', type: 'text' },
        { name: 'main_currency_id', type: 'smallint', default: 1 },
        { name: 'language', type: 'text', default: "'en'" },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'categories',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'group_id', type: 'uuid' },
        { name: 'parent_id', type: 'uuid', isNullable: true },
        { name: 'type', type: 'enum', enum: ['income', 'expense'], enumName: 'category_type' },
        { name: 'name', type: 'text' },
        { name: 'icon', type: 'text', isNullable: true },
        { name: 'color', type: 'text', isNullable: true },
        { name: 'sort_order', type: 'int', default: 0 },
        { name: 'archived', type: 'boolean', default: false },
        { name: 'archived_at', type: 'timestamptz', isNullable: true },
        { name: 'created_by', type: 'uuid' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        { name: 'deleted_at', type: 'timestamptz', isNullable: true },
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'tags',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'group_id', type: 'uuid' },
        { name: 'name', type: 'text' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'accounts',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'group_id', type: 'uuid' },
        { name: 'type', type: 'enum', enum: ['regular', 'debt', 'savings'], enumName: 'account_type', default: "'regular'" },
        { name: 'name', type: 'text' },
        { name: 'currency_id', type: 'smallint' },
        { name: 'is_favourite', type: 'boolean', default: false },
        { name: 'icon', type: 'text', isNullable: true },
        { name: 'color', type: 'text', isNullable: true },
        { name: 'description', type: 'text', isNullable: true },
        { name: 'is_included_in_balance', type: 'boolean', default: true },
        { name: 'sort_order', type: 'int', default: 0 },
        { name: 'archived', type: 'boolean', default: false },
        { name: 'archived_at', type: 'timestamptz', isNullable: true },
        { name: 'cached_balance', type: 'numeric', precision: 14, scale: 2, default: 0 },
        { name: 'created_by', type: 'uuid' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        { name: 'deleted_at', type: 'timestamptz', isNullable: true },
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'account_targets',
      columns: [
        { name: 'account_id', type: 'uuid', isPrimary: true },
        { name: 'limit_amount', type: 'numeric', precision: 14, scale: 2, isNullable: true },
        { name: 'goal_amount', type: 'numeric', precision: 14, scale: 2, isNullable: true },
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'transactions',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'group_id', type: 'uuid' },
        { name: 'type', type: 'enum', enum: ['expense', 'income', 'transfer'], enumName: 'transaction_type' },
        { name: 'date', type: 'timestamptz' },
        { name: 'amount', type: 'numeric', precision: 14, scale: 2 },
        { name: 'currency_id', type: 'smallint' },
        { name: 'account_id', type: 'uuid' },
        { name: 'category_id', type: 'uuid', isNullable: true },
        { name: 'to_account_id', type: 'uuid', isNullable: true },
        { name: 'dest_amount', type: 'numeric', precision: 14, scale: 2, isNullable: true },
        { name: 'note', type: 'text', isNullable: true },
        { name: 'created_by', type: 'uuid' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        { name: 'deleted_at', type: 'timestamptz', isNullable: true },
      ],
      checks: [
        new TableCheck({
          name: 'chk_transaction_sides',
          expression: `(type = 'transfer' AND to_account_id IS NOT NULL AND category_id IS NULL) OR (type IN ('expense', 'income') AND to_account_id IS NULL)`,
        }),
        new TableCheck({
          name: 'chk_transaction_amount_positive',
          expression: `amount > 0 AND (dest_amount IS NULL OR dest_amount > 0)`,
        }),
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'transaction_tags',
      columns: [
        { name: 'transaction_id', type: 'uuid', isPrimary: true },
        { name: 'tag_id', type: 'uuid', isPrimary: true },
      ],
    }),
    true,
  );

  await queryRunner.createTable(
    new Table({
      name: 'recurring_rules',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'group_id', type: 'uuid' },
        { name: 'type', type: 'enum', enum: ['expense', 'income', 'transfer'], enumName: 'transaction_type' },
        { name: 'amount', type: 'numeric', precision: 14, scale: 2 },
        { name: 'currency_id', type: 'smallint' },
        { name: 'account_id', type: 'uuid' },
        { name: 'category_id', type: 'uuid', isNullable: true },
        { name: 'to_account_id', type: 'uuid', isNullable: true },
        { name: 'note', type: 'text', isNullable: true },
        { name: 'interval_unit', type: 'enum', enum: ['day', 'week', 'month', 'year'], enumName: 'recurrence_unit' },
        { name: 'interval_value', type: 'int', default: 1 },
        { name: 'next_run_date', type: 'timestamptz' },
        { name: 'reminder_days_before', type: 'int', isNullable: true },
        { name: 'active', type: 'boolean', default: true },
        { name: 'created_by', type: 'uuid' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
        { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        { name: 'deleted_at', type: 'timestamptz', isNullable: true },
      ],
      checks: [
        new TableCheck({
          name: 'chk_recurring_sides',
          expression: `(type = 'transfer' AND to_account_id IS NOT NULL AND category_id IS NULL) OR (type IN ('expense', 'income') AND to_account_id IS NULL)`,
        }),
        new TableCheck({ name: 'chk_recurring_amount_positive', expression: `amount > 0` }),
      ],
    }),
    true,
  );
}

// All tables exist by this point — foreign keys added as a separate pass so table
// creation order above never has to worry about forward references (e.g. transactions
// pointing at accounts, categories self-referencing parent_id).
async function createForeignKeys(queryRunner: QueryRunner): Promise<void> {
  const cascadeToUsers = (columnNames: string[]) =>
    new TableForeignKey({ columnNames, referencedTableName: 'users', referencedColumnNames: ['id'], onDelete: 'CASCADE' });
  const refUsers = (columnNames: string[]) =>
    new TableForeignKey({ columnNames, referencedTableName: 'users', referencedColumnNames: ['id'] });

  await queryRunner.createForeignKey('groups', cascadeToUsers(['owner_id']));

  await queryRunner.createForeignKey(
    'group_members',
    new TableForeignKey({ columnNames: ['group_id'], referencedTableName: 'groups', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );
  await queryRunner.createForeignKey('group_members', cascadeToUsers(['user_id']));

  await queryRunner.createForeignKey(
    'profiles',
    new TableForeignKey({ columnNames: ['id'], referencedTableName: 'users', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );
  await queryRunner.createForeignKey(
    'profiles',
    new TableForeignKey({ columnNames: ['main_currency_id'], referencedTableName: 'currencies', referencedColumnNames: ['id'] }),
  );

  await queryRunner.createForeignKey(
    'categories',
    new TableForeignKey({ columnNames: ['group_id'], referencedTableName: 'groups', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );
  await queryRunner.createForeignKey(
    'categories',
    new TableForeignKey({ columnNames: ['parent_id'], referencedTableName: 'categories', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey('categories', refUsers(['created_by']));

  await queryRunner.createForeignKey(
    'tags',
    new TableForeignKey({ columnNames: ['group_id'], referencedTableName: 'groups', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );

  await queryRunner.createForeignKey(
    'accounts',
    new TableForeignKey({ columnNames: ['group_id'], referencedTableName: 'groups', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );
  await queryRunner.createForeignKey(
    'accounts',
    new TableForeignKey({ columnNames: ['currency_id'], referencedTableName: 'currencies', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey('accounts', refUsers(['created_by']));

  await queryRunner.createForeignKey(
    'account_targets',
    new TableForeignKey({ columnNames: ['account_id'], referencedTableName: 'accounts', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );

  await queryRunner.createForeignKey(
    'transactions',
    new TableForeignKey({ columnNames: ['group_id'], referencedTableName: 'groups', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );
  await queryRunner.createForeignKey(
    'transactions',
    new TableForeignKey({ columnNames: ['currency_id'], referencedTableName: 'currencies', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey(
    'transactions',
    new TableForeignKey({ columnNames: ['account_id'], referencedTableName: 'accounts', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey(
    'transactions',
    new TableForeignKey({ columnNames: ['category_id'], referencedTableName: 'categories', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey(
    'transactions',
    new TableForeignKey({ columnNames: ['to_account_id'], referencedTableName: 'accounts', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey('transactions', refUsers(['created_by']));

  await queryRunner.createForeignKey(
    'transaction_tags',
    new TableForeignKey({ columnNames: ['transaction_id'], referencedTableName: 'transactions', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );
  await queryRunner.createForeignKey(
    'transaction_tags',
    new TableForeignKey({ columnNames: ['tag_id'], referencedTableName: 'tags', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );

  await queryRunner.createForeignKey(
    'recurring_rules',
    new TableForeignKey({ columnNames: ['group_id'], referencedTableName: 'groups', referencedColumnNames: ['id'], onDelete: 'CASCADE' }),
  );
  await queryRunner.createForeignKey(
    'recurring_rules',
    new TableForeignKey({ columnNames: ['currency_id'], referencedTableName: 'currencies', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey(
    'recurring_rules',
    new TableForeignKey({ columnNames: ['account_id'], referencedTableName: 'accounts', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey(
    'recurring_rules',
    new TableForeignKey({ columnNames: ['category_id'], referencedTableName: 'categories', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey(
    'recurring_rules',
    new TableForeignKey({ columnNames: ['to_account_id'], referencedTableName: 'accounts', referencedColumnNames: ['id'] }),
  );
  await queryRunner.createForeignKey('recurring_rules', refUsers(['created_by']));
}

async function createIndexesAndConstraints(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.createUniqueConstraint('tags', new TableUnique({ name: 'uq_tags_group_name', columnNames: ['group_id', 'name'] }));

  await queryRunner.createIndex('group_members', new TableIndex({ name: 'idx_group_members_user', columnNames: ['user_id'] }));
  await queryRunner.createIndex('categories', new TableIndex({ name: 'idx_categories_group', columnNames: ['group_id'], where: 'deleted_at IS NULL' }));
  await queryRunner.createIndex('accounts', new TableIndex({ name: 'idx_accounts_group', columnNames: ['group_id'], where: 'deleted_at IS NULL' }));
  await queryRunner.createIndex('transactions', new TableIndex({ name: 'idx_transactions_account', columnNames: ['account_id'], where: 'deleted_at IS NULL' }));
  await queryRunner.createIndex('transactions', new TableIndex({ name: 'idx_transactions_category', columnNames: ['category_id'], where: 'deleted_at IS NULL' }));
  await queryRunner.createIndex('recurring_rules', new TableIndex({ name: 'idx_recurring_group', columnNames: ['group_id'], where: 'deleted_at IS NULL' }));

  // (group_id, date DESC) — TableIndex has no per-column sort direction, so this one is raw SQL
  await queryRunner.query(`
    CREATE INDEX idx_transactions_group_date ON transactions (group_id, date DESC) WHERE deleted_at IS NULL
  `);
}

async function createConsistencyTrigger(queryRunner: QueryRunner): Promise<void> {
  // account_id/category_id/to_account_id must belong to the same group as the row itself —
  // a plain FK can't express that, needs an actual check
  await queryRunner.query(`
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

      RETURN NEW;
    END;
    $$
  `);

  await queryRunner.query(`
    CREATE TRIGGER trg_transactions_group_consistency
    BEFORE INSERT OR UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION check_group_consistency()
  `);

  await queryRunner.query(`
    CREATE TRIGGER trg_recurring_group_consistency
    BEFORE INSERT OR UPDATE ON recurring_rules
    FOR EACH ROW EXECUTE FUNCTION check_group_consistency()
  `);
}

async function createUpdatedAtTriggers(queryRunner: QueryRunner): Promise<void> {
  // set_updated_at() itself was created by the auth-tables migration — reused here, not redefined
  for (const table of ['groups', 'categories', 'accounts', 'transactions', 'recurring_rules']) {
    await queryRunner.query(`
      CREATE TRIGGER trg_${table}_updated
      BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
  }
}

async function createBalanceTrigger(queryRunner: QueryRunner): Promise<void> {
  // Signed contribution of one transaction row to one account's balance — same logic the
  // original account_balances view used, factored out so both INSERT/UPDATE/DELETE paths
  // of the trigger below can share it instead of repeating the CASE twice.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION transaction_balance_contribution(
      p_deleted_at timestamptz,
      p_type transaction_type,
      p_amount numeric,
      p_dest_amount numeric,
      p_account_id uuid,
      p_to_account_id uuid,
      p_target_account uuid
    ) RETURNS numeric(14, 2) LANGUAGE sql IMMUTABLE AS $$
      SELECT CASE
        WHEN p_deleted_at IS NOT NULL THEN 0
        WHEN p_account_id = p_target_account AND p_type = 'income' THEN p_amount
        WHEN p_account_id = p_target_account AND p_type = 'expense' THEN -p_amount
        WHEN p_account_id = p_target_account AND p_type = 'transfer' THEN -p_amount
        WHEN p_to_account_id = p_target_account AND p_type = 'transfer' THEN COALESCE(p_dest_amount, p_amount)
        ELSE 0
      END;
    $$
  `);

  // Keeps accounts.cached_balance in sync so reading a balance never has to scan the full
  // transaction history. Visits every account touched by OLD and/or NEW (deduplicated —
  // an unchanged account_id must not be counted twice) and applies (new contribution - old
  // contribution) as a single delta per account.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION apply_transaction_to_account_balance()
    RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE
      raw_accounts uuid[];
      affected_accounts uuid[];
      acct uuid;
      delta numeric(14, 2);
    BEGIN
      IF TG_OP = 'INSERT' THEN
        raw_accounts := ARRAY[NEW.account_id, NEW.to_account_id];
      ELSIF TG_OP = 'DELETE' THEN
        raw_accounts := ARRAY[OLD.account_id, OLD.to_account_id];
      ELSE
        raw_accounts := ARRAY[OLD.account_id, OLD.to_account_id, NEW.account_id, NEW.to_account_id];
      END IF;

      SELECT ARRAY_AGG(DISTINCT acc) INTO affected_accounts
      FROM unnest(raw_accounts) AS acc
      WHERE acc IS NOT NULL;

      IF affected_accounts IS NULL THEN
        RETURN NULL;
      END IF;

      FOREACH acct IN ARRAY affected_accounts
      LOOP
        delta := 0;

        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          delta := delta - transaction_balance_contribution(
            OLD.deleted_at, OLD.type, OLD.amount, OLD.dest_amount, OLD.account_id, OLD.to_account_id, acct
          );
        END IF;

        IF TG_OP IN ('UPDATE', 'INSERT') THEN
          delta := delta + transaction_balance_contribution(
            NEW.deleted_at, NEW.type, NEW.amount, NEW.dest_amount, NEW.account_id, NEW.to_account_id, acct
          );
        END IF;

        IF delta <> 0 THEN
          UPDATE accounts SET cached_balance = cached_balance + delta WHERE id = acct;
        END IF;
      END LOOP;

      RETURN NULL;
    END;
    $$
  `);

  await queryRunner.query(`
    CREATE TRIGGER trg_transactions_balance
    AFTER INSERT OR UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION apply_transaction_to_account_balance()
  `);
}

export const createDomainSchema: Migration = {
  name: '20260725210000-create-domain-schema',

  async up({ context: queryRunner }) {
    await createTables(queryRunner);
    await createForeignKeys(queryRunner);
    await createIndexesAndConstraints(queryRunner);
    await createConsistencyTrigger(queryRunner);
    await createUpdatedAtTriggers(queryRunner);
    await createBalanceTrigger(queryRunner);
  },

  async down({ context: queryRunner }) {
    await queryRunner.query('DROP TRIGGER IF EXISTS trg_transactions_balance ON transactions');
    await queryRunner.query('DROP FUNCTION IF EXISTS apply_transaction_to_account_balance()');
    await queryRunner.query('DROP FUNCTION IF EXISTS transaction_balance_contribution(timestamptz, transaction_type, numeric, numeric, uuid, uuid, uuid)');

    for (const table of ['groups', 'categories', 'accounts', 'transactions', 'recurring_rules']) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS trg_${table}_updated ON ${table}`);
    }

    await queryRunner.query('DROP TRIGGER IF EXISTS trg_recurring_group_consistency ON recurring_rules');
    await queryRunner.query('DROP TRIGGER IF EXISTS trg_transactions_group_consistency ON transactions');
    await queryRunner.query('DROP FUNCTION IF EXISTS check_group_consistency()');

    await queryRunner.dropTable('recurring_rules', true);
    await queryRunner.dropTable('transaction_tags', true);
    await queryRunner.dropTable('transactions', true);
    await queryRunner.dropTable('account_targets', true);
    await queryRunner.dropTable('accounts', true);
    await queryRunner.dropTable('tags', true);
    await queryRunner.dropTable('categories', true);
    await queryRunner.dropTable('profiles', true);
    await queryRunner.dropTable('group_members', true);
    await queryRunner.dropTable('groups', true);
    await queryRunner.dropTable('currencies', true);

    for (const enumName of ['transaction_type', 'recurrence_unit', 'account_type', 'category_type', 'member_role']) {
      await queryRunner.query(`DROP TYPE IF EXISTS ${enumName}`);
    }
  },
};
