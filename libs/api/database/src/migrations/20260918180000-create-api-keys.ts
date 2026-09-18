import { Table, TableCheck, TableForeignKey, TableIndex } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Keys other apps authenticate with to reach the external API, each one a member's key for one
// group.
//
// The foreign key goes to the membership, (group_id, user_id), rather than to the user and the
// group apart. A key then can't outlive its owner's place in the group: removing a member,
// leaving, deleting the group or the user all cascade to it. Referential actions and checks
// bypass row security, so the cascade also reaches keys the person removing a member couldn't
// see, and the insert-time check that the owner is a member can't be hidden by a policy.
async function up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.createTable(
    new Table({
      name: 'api_keys',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'group_id', type: 'uuid' },
        { name: 'user_id', type: 'uuid' },
        { name: 'name', type: 'text' },
        { name: 'token_hash', type: 'text', isUnique: true },
        { name: 'token_prefix', type: 'text' },
        { name: 'scopes', type: 'text', isArray: true },
        { name: 'expires_at', type: 'timestamptz', isNullable: true },
        { name: 'last_used_at', type: 'timestamptz', isNullable: true },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
      ],
      checks: [new TableCheck({ name: 'chk_api_keys_scopes', expression: 'cardinality(scopes) > 0' })],
    }),
    true,
  );

  await queryRunner.createForeignKey(
    'api_keys',
    new TableForeignKey({
      columnNames: ['group_id', 'user_id'],
      referencedTableName: 'group_members',
      referencedColumnNames: ['group_id', 'user_id'],
      onDelete: 'CASCADE',
    }),
  );

  await queryRunner.createIndex('api_keys', new TableIndex({ name: 'idx_api_keys_member', columnNames: ['group_id', 'user_id'] }));

  // You see and manage your own keys only — co-members included, and whatever your role.
  await queryRunner.query('ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY');
  await queryRunner.query(`
    CREATE POLICY api_keys_owner ON api_keys FOR ALL
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id())
  `);

  // A request carrying a key has no identity yet — finding out whose key it is is the point — so
  // the policy above would hide every row from it. This function is the one way past: given the
  // hash of a key, it returns that key's owner, group and scopes, and nothing about any other key.
  // SECURITY DEFINER runs it as the table's owner; the pinned search_path keeps anything a caller
  // puts earlier on theirs from standing in for the tables and functions it names.
  //
  // It also records the use, at most once a minute so a busy key doesn't write on every request.
  // Expired keys are left out here rather than checked by the caller, so no caller can forget to.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION authenticate_api_key(p_token_hash text)
    RETURNS TABLE (key_id uuid, user_id uuid, group_id uuid, scopes text[])
    LANGUAGE sql SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      WITH found AS (
        SELECT k.id, k.user_id, k.group_id, k.scopes, k.last_used_at
        FROM api_keys k
        WHERE k.token_hash = p_token_hash
          AND (k.expires_at IS NULL OR k.expires_at > now())
      ), touched AS (
        UPDATE api_keys k SET last_used_at = now()
        FROM found f
        WHERE k.id = f.id
          AND (f.last_used_at IS NULL OR f.last_used_at < now() - interval '1 minute')
      )
      SELECT f.id, f.user_id, f.group_id, f.scopes FROM found f
    $$
  `);
}

async function down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query('DROP FUNCTION IF EXISTS authenticate_api_key(text)');
  // Takes its policy, index and foreign key along.
  await queryRunner.dropTable('api_keys', true);
}

export const createApiKeys: Migration = {
  name: '20260918180000-create-api-keys',

  async up({ context: queryRunner }) {
    await up(queryRunner);
  },

  async down({ context: queryRunner }) {
    await down(queryRunner);
  },
};
