import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Tables with a direct group_id column, all following the same policy shape:
// any member reads, only non-viewers in a non-archived group write.
const GROUP_SCOPED_TABLES = ['accounts', 'categories', 'tags', 'transactions', 'recurring_rules'] as const;

// RLS applies to every table below. Deliberately excluded:
//   users / auth_identities / refresh_tokens — the auth flow queries these *before* an
//     identity exists (login looks up by email), so there is no app.current_user_id to
//     filter on. They are only ever touched by AuthService with server-controlled filters.
//   currencies — global read-only reference data, nothing user-specific to hide.
//   migrations_history — infrastructure, only the migration runner touches it.
const RLS_TABLES = [
  'profiles',
  'groups',
  'group_members',
  'account_targets',
  'transaction_tags',
  ...GROUP_SCOPED_TABLES,
] as const;

// Runtime role the API connects as. It is deliberately NOT the table owner: a table's owner
// bypasses that table's RLS policies unless FORCE ROW LEVEL SECURITY is set, so running the
// app as the owner would silently disable every policy below. Migrations keep running as the
// owner, which is what lets them seed reference data and backfill without tripping policies.
const APP_ROLE = 'ft_user';

async function createHelperFunctions(queryRunner: QueryRunner): Promise<void> {
  // The Supabase original read auth.uid(); outside Supabase that function doesn't exist.
  // The equivalent is a session variable set by the app at the start of each transaction.
  // missing_ok = true so this returns NULL (not an error) on connections that never set it,
  // e.g. the auth endpoints, which must work before any identity is established.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
    $$
  `);

  // SECURITY DEFINER on purpose: these run as the function owner so that reading
  // group_members doesn't itself trigger group_members' RLS policy, which would recurse.
  //
  // Fixes a bug in the original: it was `where p_group_id is null OR (...)`, so
  // is_group_member(NULL) returned true and matched every row. Here a NULL group id or a
  // NULL current user can never satisfy the check.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION is_group_member(p_group_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE AS $$
      SELECT p_group_id IS NOT NULL
        AND app_current_user_id() IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM group_members
          WHERE group_id = p_group_id AND user_id = app_current_user_id()
        );
    $$
  `);

  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION group_role(p_group_id uuid) RETURNS member_role
    LANGUAGE sql SECURITY DEFINER STABLE AS $$
      SELECT role FROM group_members
      WHERE group_id = p_group_id AND user_id = app_current_user_id();
    $$
  `);

  // owner/admin/member may write, viewer may not; an archived group is read-only for
  // everyone including its owner (unarchive first).
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION can_write_group(p_group_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE AS $$
      SELECT group_role(p_group_id) IN ('owner', 'admin', 'member')
        AND NOT EXISTS (
          SELECT 1 FROM groups WHERE id = p_group_id AND archived_at IS NOT NULL
        );
    $$
  `);
}

async function grantAppRole(queryRunner: QueryRunner): Promise<void> {
  // The role itself is created by bootstrap.sql, not here — see the note in that file on why
  // role creation stays out of migrations. Fail with something actionable if it was skipped.
  await queryRunner.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        RAISE EXCEPTION 'Role "${APP_ROLE}" does not exist. Run libs/api/database/bootstrap.sql as a superuser first.';
      END IF;
    END
    $$
  `);

  await queryRunner.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await queryRunner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  await queryRunner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);

  // ALL TABLES above is a one-time snapshot — without these defaults, any table a future
  // migration creates would be invisible to the app role until someone remembers to grant it.
  await queryRunner.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}
  `);
  await queryRunner.query(`
    ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}
  `);
}

async function enableRls(queryRunner: QueryRunner): Promise<void> {
  for (const table of RLS_TABLES) {
    await queryRunner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  }
}

async function createPolicies(queryRunner: QueryRunner): Promise<void> {
  // profiles: you see and edit only your own.
  await queryRunner.query(`CREATE POLICY profiles_select ON profiles FOR SELECT USING (id = app_current_user_id())`);
  await queryRunner.query(`
    CREATE POLICY profiles_update ON profiles FOR UPDATE
    USING (id = app_current_user_id()) WITH CHECK (id = app_current_user_id())
  `);
  // Needed by register(): the profile row is created for yourself, nobody else.
  await queryRunner.query(`CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (id = app_current_user_id())`);

  // groups: visible to members, created with yourself as owner, renamed/archived by owner only.
  // No DELETE policy on purpose — hard-deleting a group through the API is forbidden; the
  // lifecycle is archive/restore. RLS denies anything without an explicit policy.
  await queryRunner.query(`CREATE POLICY groups_select ON groups FOR SELECT USING (is_group_member(id))`);
  await queryRunner.query(`CREATE POLICY groups_insert ON groups FOR INSERT WITH CHECK (owner_id = app_current_user_id())`);
  await queryRunner.query(`
    CREATE POLICY groups_update ON groups FOR UPDATE
    USING (group_role(id) = 'owner') WITH CHECK (group_role(id) = 'owner')
  `);

  // group_members: members see each other. Inserting is owner/admin only, but the very first
  // row (the creator becoming owner of a brand-new group) has no pre-existing membership to
  // check against, hence the second disjunct.
  await queryRunner.query(`
    CREATE POLICY group_members_select ON group_members FOR SELECT USING (is_group_member(group_id))
  `);
  await queryRunner.query(`
    CREATE POLICY group_members_insert ON group_members FOR INSERT WITH CHECK (
      group_role(group_id) IN ('owner', 'admin')
      OR (
        user_id = app_current_user_id()
        AND EXISTS (SELECT 1 FROM groups WHERE id = group_id AND owner_id = app_current_user_id())
        AND NOT EXISTS (SELECT 1 FROM group_members existing WHERE existing.group_id = group_members.group_id)
      )
    )
  `);
  await queryRunner.query(`
    CREATE POLICY group_members_update ON group_members FOR UPDATE
    USING (group_role(group_id) IN ('owner', 'admin'))
    WITH CHECK (group_role(group_id) IN ('owner', 'admin'))
  `);
  // Admins/owners can remove people, anyone can remove themselves, but the last owner can
  // never be removed — that would orphan the group. MembersService checks this too, only to
  // return a readable 4xx instead of a bare policy violation.
  await queryRunner.query(`
    CREATE POLICY group_members_delete ON group_members FOR DELETE USING (
      (group_role(group_id) IN ('owner', 'admin') OR user_id = app_current_user_id())
      AND NOT (
        role = 'owner'
        AND (SELECT count(*) FROM group_members others WHERE others.group_id = group_members.group_id AND others.role = 'owner') <= 1
      )
    )
  `);

  for (const table of GROUP_SCOPED_TABLES) {
    await queryRunner.query(`CREATE POLICY ${table}_select ON ${table} FOR SELECT USING (is_group_member(group_id))`);
    await queryRunner.query(`CREATE POLICY ${table}_insert ON ${table} FOR INSERT WITH CHECK (can_write_group(group_id))`);
    // WITH CHECK mirrors USING so a row can't be moved into a group you may write to from
    // one you may not, or vice versa. The original schema omitted this.
    await queryRunner.query(`
      CREATE POLICY ${table}_update ON ${table} FOR UPDATE
      USING (can_write_group(group_id)) WITH CHECK (can_write_group(group_id))
    `);
    await queryRunner.query(`CREATE POLICY ${table}_delete ON ${table} FOR DELETE USING (can_write_group(group_id))`);
  }

  // Child tables with no group_id of their own — scope is inherited from the parent row.
  await queryRunner.query(`
    CREATE POLICY account_targets_select ON account_targets FOR SELECT USING (
      is_group_member((SELECT group_id FROM accounts WHERE id = account_id))
    )
  `);
  await queryRunner.query(`
    CREATE POLICY account_targets_write ON account_targets FOR ALL USING (
      can_write_group((SELECT group_id FROM accounts WHERE id = account_id))
    ) WITH CHECK (
      can_write_group((SELECT group_id FROM accounts WHERE id = account_id))
    )
  `);
  await queryRunner.query(`
    CREATE POLICY transaction_tags_select ON transaction_tags FOR SELECT USING (
      is_group_member((SELECT group_id FROM transactions WHERE id = transaction_id))
    )
  `);
  await queryRunner.query(`
    CREATE POLICY transaction_tags_write ON transaction_tags FOR ALL USING (
      can_write_group((SELECT group_id FROM transactions WHERE id = transaction_id))
    ) WITH CHECK (
      can_write_group((SELECT group_id FROM transactions WHERE id = transaction_id))
    )
  `);
}

export const enableRowLevelSecurity: Migration = {
  name: '20260726120000-enable-rls',

  async up({ context: queryRunner }) {
    await createHelperFunctions(queryRunner);
    await grantAppRole(queryRunner);
    await enableRls(queryRunner);
    await createPolicies(queryRunner);
  },

  async down({ context: queryRunner }) {
    for (const table of RLS_TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
      // Policies are dropped implicitly with the table, but not on a plain disable.
      await queryRunner.query(`
        DO $$
        DECLARE policy_name text;
        BEGIN
          FOR policy_name IN SELECT policyname FROM pg_policies WHERE tablename = '${table}'
          LOOP
            EXECUTE format('DROP POLICY %I ON ${table}', policy_name);
          END LOOP;
        END
        $$
      `);
    }

    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
      REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${APP_ROLE}
    `);
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
      REVOKE USAGE, SELECT ON SEQUENCES FROM ${APP_ROLE}
    `);
    await queryRunner.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${APP_ROLE}`);
    await queryRunner.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${APP_ROLE}`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM ${APP_ROLE}`);

    await queryRunner.query('DROP FUNCTION IF EXISTS can_write_group(uuid)');
    await queryRunner.query('DROP FUNCTION IF EXISTS group_role(uuid)');
    await queryRunner.query('DROP FUNCTION IF EXISTS is_group_member(uuid)');
    await queryRunner.query('DROP FUNCTION IF EXISTS app_current_user_id()');
  },
};
