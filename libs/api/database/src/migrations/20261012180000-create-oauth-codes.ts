import { Table, TableCheck, TableColumn, TableForeignKey } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Sign-in for apps that connect over OAuth, such as an AI assistant reaching the MCP endpoint.
//
// When a member allows such an app into a group, the API hands the app a one-time code, kept here
// by its hash only. The app trades the code for a read-only API key within minutes, and the row is
// gone with that trade. Like an API key, the code hangs off its member's place in the group:
// leaving the group, or the group going, takes pending codes with it.
async function up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.createTable(
    new Table({
      name: 'oauth_codes',
      columns: [
        // sha256 of the code, hex.
        { name: 'code_hash', type: 'text', isPrimary: true },
        { name: 'group_id', type: 'uuid' },
        { name: 'user_id', type: 'uuid' },
        // The app, as it registered: its client_id carries its name and where it may be sent back to.
        { name: 'client_id', type: 'text' },
        { name: 'client_name', type: 'text' },
        // Exactly the one the app asked to be sent back to: the trade must name it again.
        { name: 'redirect_uri', type: 'text' },
        // PKCE: the S256 digest of a secret only the app holds, which the trade must reveal.
        { name: 'code_challenge', type: 'text' },
        { name: 'scopes', type: 'text', isArray: true },
        // The member's, from the browser that allowed the app: where its reports count their days.
        { name: 'time_zone', type: 'text', isNullable: true },
        { name: 'expires_at', type: 'timestamptz' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
      ],
    }),
    true,
  );

  await queryRunner.createForeignKey(
    'oauth_codes',
    new TableForeignKey({
      columnNames: ['group_id', 'user_id'],
      referencedTableName: 'group_members',
      referencedColumnNames: ['group_id', 'user_id'],
      onDelete: 'CASCADE',
    }),
  );

  // A member makes codes for themselves only.
  await queryRunner.query('ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY');
  await queryRunner.query(`
    CREATE POLICY oauth_codes_owner ON oauth_codes FOR ALL
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id())
  `);

  // The app trading a code in has no identity yet — the code is how it gets one — so the policy
  // above hides every row from it. As authenticate_api_key() does for keys, this is the one way
  // past: given a code's hash it deletes that code, so it can't be traded twice, and returns it if
  // it was still good. Codes left untraded are cleared away by later calls.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION redeem_oauth_code(p_code_hash text)
    RETURNS TABLE (
      user_id uuid,
      group_id uuid,
      client_id text,
      client_name text,
      redirect_uri text,
      code_challenge text,
      scopes text[],
      time_zone text
    )
    LANGUAGE sql SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      WITH redeemed AS (
        DELETE FROM oauth_codes c
        WHERE c.code_hash = p_code_hash
        RETURNING c.user_id, c.group_id, c.client_id, c.client_name, c.redirect_uri, c.code_challenge,
                  c.scopes, c.time_zone, c.expires_at
      ), abandoned AS (
        DELETE FROM oauth_codes c
        WHERE c.expires_at < now() - interval '1 day'
          AND c.code_hash <> p_code_hash
      )
      SELECT r.user_id, r.group_id, r.client_id, r.client_name, r.redirect_uri, r.code_challenge, r.scopes, r.time_zone
      FROM redeemed r
      WHERE r.expires_at > now()
    $$
  `);

  // Where a key's reports count their days when a request names no time zone: the browser's that
  // made the key, or allowed the app it was made for.
  await queryRunner.addColumn('api_keys', new TableColumn({ name: 'time_zone', type: 'text', isNullable: true }));

  // The app a sign-in made the key for, set on those keys only: its registered name, and the
  // redirect it signs in through. When the same app signs in again, its new key replaces this one,
  // rather than leaving a key behind that nothing holds any more.
  await queryRunner.addColumns('api_keys', [
    new TableColumn({ name: 'oauth_client_name', type: 'text', isNullable: true }),
    new TableColumn({ name: 'oauth_redirect_uri', type: 'text', isNullable: true }),
  ]);
  await queryRunner.createCheckConstraint(
    'api_keys',
    new TableCheck({ name: 'chk_api_keys_oauth_app', expression: 'num_nonnulls(oauth_client_name, oauth_redirect_uri) IN (0, 2)' }),
  );
}

async function down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.dropCheckConstraint('api_keys', 'chk_api_keys_oauth_app');
  await queryRunner.dropColumns('api_keys', ['oauth_client_name', 'oauth_redirect_uri']);
  await queryRunner.dropColumn('api_keys', 'time_zone');
  await queryRunner.query('DROP FUNCTION IF EXISTS redeem_oauth_code(text)');
  // Takes its policy and foreign key along.
  await queryRunner.dropTable('oauth_codes', true);
}

export const createOauthCodes: Migration = {
  name: '20261012180000-create-oauth-codes',

  async up({ context: queryRunner }) {
    await up(queryRunner);
  },

  async down({ context: queryRunner }) {
    await down(queryRunner);
  },
};
