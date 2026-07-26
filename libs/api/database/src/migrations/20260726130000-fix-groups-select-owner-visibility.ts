import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// groups_select (from 20260726120000-enable-rls) only allowed `is_group_member(id)`. That
// breaks group creation: Repository.save() always does INSERT ... RETURNING, and Postgres
// evaluates RETURNING against the table's SELECT policies, not just the INSERT policy's
// WITH CHECK. At the moment the group row is inserted there is no group_members row yet for
// the new owner (that insert happens afterward, in the same service method) — so
// is_group_member(id) is false and the whole statement fails with "new row violates
// row-level security policy for table groups", even though the INSERT itself was allowed.
//
// group_members_insert already had to work around the identical chicken-and-egg problem for
// the first membership row; this applies the same shape of fix one level up, for the group
// row itself: the owner can always see a group they own, membership row or not.
//
// group_members_select has the same problem one level deeper, and for a subtler reason: a
// single INSERT ... RETURNING does not see its own row through a fresh sub-query (Postgres
// only advances the command counter between statements, not within one), so even
// is_group_member(group_id) — despite being SECURITY DEFINER and querying group_members
// directly — can't find the row it is itself part of. Confirmed directly against Postgres
// with psql, independent of the app: the exact same INSERT ... RETURNING fails under the
// original policy and succeeds once the row can also be recognized by `user_id =
// app_current_user_id()`, without going through is_group_member() at all. That disjunct is
// also just correct on its own terms — a member should always be able to see their own
// membership row.
async function up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query('DROP POLICY groups_select ON groups');
  await queryRunner.query(`
    CREATE POLICY groups_select ON groups FOR SELECT USING (
      is_group_member(id) OR owner_id = app_current_user_id()
    )
  `);

  await queryRunner.query('DROP POLICY group_members_select ON group_members');
  await queryRunner.query(`
    CREATE POLICY group_members_select ON group_members FOR SELECT USING (
      is_group_member(group_id) OR user_id = app_current_user_id()
    )
  `);
}

async function down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query('DROP POLICY group_members_select ON group_members');
  await queryRunner.query(`
    CREATE POLICY group_members_select ON group_members FOR SELECT USING (is_group_member(group_id))
  `);

  await queryRunner.query('DROP POLICY groups_select ON groups');
  await queryRunner.query(`CREATE POLICY groups_select ON groups FOR SELECT USING (is_group_member(id))`);
}

export const fixGroupsSelectOwnerVisibility: Migration = {
  name: '20260726130000-fix-groups-select-owner-visibility',

  async up({ context: queryRunner }) {
    await up(queryRunner);
  },

  async down({ context: queryRunner }) {
    await down(queryRunner);
  },
};
