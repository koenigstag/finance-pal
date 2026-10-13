import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// What another app changed through an API key, so it can be taken back: a change set per write an
// assistant makes over MCP (one tool call, or a batch of them), and the rows it touched, each as
// it was before and after. The rows are written by a trigger, so whatever a change took along —
// a series' occurrence, an amount worked out again from the balance, what a deleted category left
// uncategorized — is there too. Undoing puts those rows back.
//
// The trigger only writes while app.change_set_id is set, which the API does for the length of a
// change, inside the request's transaction: every other write skips it at the WHEN.
//
// Transactions and series also keep the name of the key they were added through, as their source.

// The tables an assistant's tools write to, directly or through what they take along.
const RECORDED_TABLES = ['transactions', 'accounts', 'categories', 'budgets', 'recurring_rules', 'category_rules'];

async function up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query('ALTER TABLE transactions ADD COLUMN source text');
  await queryRunner.query('ALTER TABLE recurring_rules ADD COLUMN source text');

  // The key's name now comes back with it, for what it adds to name as their source. The return
  // type changes, so the function is replaced rather than redefined.
  await queryRunner.query('DROP FUNCTION authenticate_api_key(text)');
  await queryRunner.query(authenticateApiKeySql(true));

  await queryRunner.query(`
    CREATE TABLE change_sets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
      created_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      -- Kept when the key goes: reconnecting an assistant replaces its key, and what it did stays its.
      api_key_id uuid REFERENCES api_keys (id) ON DELETE SET NULL,
      -- The key's name when the change was made.
      source text NOT NULL,
      description text,
      -- The tool calls it was made of, as they were asked for.
      steps jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      undone_at timestamptz
    )
  `);
  await queryRunner.query('CREATE INDEX idx_change_sets_group_created ON change_sets (group_id, created_at DESC)');

  await queryRunner.query(`
    CREATE TABLE change_set_rows (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      change_set_id uuid NOT NULL REFERENCES change_sets (id) ON DELETE CASCADE,
      -- The row's own group, which the policies go by.
      group_id uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
      table_name text NOT NULL,
      row_id uuid NOT NULL,
      op text NOT NULL CHECK (op IN ('INSERT', 'UPDATE', 'DELETE')),
      old_row jsonb,
      new_row jsonb
    )
  `);
  await queryRunner.query('CREATE INDEX idx_change_set_rows_change ON change_set_rows (change_set_id, id)');

  for (const table of ['change_sets', 'change_set_rows']) {
    await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`CREATE POLICY ${table}_select ON ${table} FOR SELECT USING (is_group_member(group_id))`);
    await queryRunner.query(`CREATE POLICY ${table}_insert ON ${table} FOR INSERT WITH CHECK (can_write_group(group_id))`);
    await queryRunner.query(`
      CREATE POLICY ${table}_update ON ${table} FOR UPDATE
      USING (can_write_group(group_id)) WITH CHECK (can_write_group(group_id))
    `);
    await queryRunner.query(`CREATE POLICY ${table}_delete ON ${table} FOR DELETE USING (can_write_group(group_id))`);
  }

  // As the caller, under the policies above: a row is only recorded where its writer may write.
  await queryRunner.query(`
    CREATE FUNCTION record_change_row() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      v_old jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
      v_new jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
    BEGIN
      INSERT INTO change_set_rows (change_set_id, group_id, table_name, row_id, op, old_row, new_row)
      VALUES (
        current_setting('app.change_set_id')::uuid,
        (coalesce(v_new, v_old) ->> 'group_id')::uuid,
        TG_TABLE_NAME,
        (coalesce(v_new, v_old) ->> 'id')::uuid,
        TG_OP,
        v_old,
        v_new
      );
      RETURN NULL;
    END
    $$
  `);
  for (const table of RECORDED_TABLES) {
    await queryRunner.query(`
      CREATE TRIGGER trg_${table}_change_rows
      AFTER INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW
      WHEN (coalesce(current_setting('app.change_set_id', true), '') <> '')
      EXECUTE FUNCTION record_change_row()
    `);
  }

  // Puts one row back as a change found it: deletes it when it wasn't there (image null), and
  // otherwise writes the image's columns over it, or inserts it again if it's gone. The columns in
  // p_kept stay as they are on a row that's still there: ones a trigger keeps, like an account's
  // cached balance, which follows its transactions as they're put back. As the caller, so the
  // policies decide as they would for any write.
  await queryRunner.query(`
    CREATE FUNCTION undo_change_row(p_table regclass, p_id uuid, p_image jsonb, p_kept text[]) RETURNS void
    LANGUAGE plpgsql AS $$
    DECLARE
      v_all text;
      v_written text;
      v_count integer;
    BEGIN
      IF p_image IS NULL THEN
        EXECUTE format('DELETE FROM %s WHERE id = $1', p_table) USING p_id;
        RETURN;
      END IF;
      SELECT
        string_agg(quote_ident(attname), ', ' ORDER BY attnum),
        string_agg(quote_ident(attname), ', ' ORDER BY attnum) FILTER (WHERE attname <> ALL (p_kept))
      INTO v_all, v_written
      FROM pg_attribute
      WHERE attrelid = p_table AND attnum > 0 AND NOT attisdropped AND attgenerated = '';
      EXECUTE format(
        'UPDATE %1$s SET (%2$s) = (SELECT %2$s FROM jsonb_populate_record(NULL::%1$s, $1)) WHERE id = $2',
        p_table, v_written
      ) USING p_image, p_id;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count = 0 THEN
        EXECUTE format('INSERT INTO %1$s (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::%1$s, $1)', p_table, v_all)
        USING p_image;
      END IF;
    END
    $$
  `);
}

async function down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query('DROP FUNCTION IF EXISTS undo_change_row(regclass, uuid, jsonb, text[])');
  for (const table of RECORDED_TABLES) {
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_${table}_change_rows ON ${table}`);
  }
  await queryRunner.query('DROP FUNCTION IF EXISTS record_change_row()');
  await queryRunner.query('DROP TABLE IF EXISTS change_set_rows');
  await queryRunner.query('DROP TABLE IF EXISTS change_sets');
  await queryRunner.query('DROP FUNCTION authenticate_api_key(text)');
  await queryRunner.query(authenticateApiKeySql(false));
  await queryRunner.query('ALTER TABLE recurring_rules DROP COLUMN source');
  await queryRunner.query('ALTER TABLE transactions DROP COLUMN source');
}

// As 20260918180000-create-api-keys defines it, with or without the key's name.
function authenticateApiKeySql(withName: boolean): string {
  const name = withName ? ', name text' : '';
  const selectName = withName ? ', k.name' : '';
  const returnName = withName ? ', f.name' : '';
  return `
    CREATE FUNCTION authenticate_api_key(p_token_hash text)
    RETURNS TABLE (key_id uuid, user_id uuid, group_id uuid, scopes text[]${name})
    LANGUAGE sql SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      WITH found AS (
        SELECT k.id, k.user_id, k.group_id, k.scopes, k.last_used_at${selectName}
        FROM api_keys k
        WHERE k.token_hash = p_token_hash
          AND (k.expires_at IS NULL OR k.expires_at > now())
      ), touched AS (
        UPDATE api_keys k SET last_used_at = now()
        FROM found f
        WHERE k.id = f.id
          AND (f.last_used_at IS NULL OR f.last_used_at < now() - interval '1 minute')
      )
      SELECT f.id, f.user_id, f.group_id, f.scopes${returnName} FROM found f
    $$
  `;
}

export const createChangeSets: Migration = {
  name: '20261013180000-create-change-sets',

  async up({ context: queryRunner }) {
    await up(queryRunner);
  },

  async down({ context: queryRunner }) {
    await down(queryRunner);
  },
};
