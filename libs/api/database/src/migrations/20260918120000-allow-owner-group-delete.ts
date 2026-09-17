import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Groups were archive-only at first (see enable-rls). Owners can now delete a group outright,
// taking everything in it along: accounts, categories, tags, transactions, recurring rules and
// memberships all reference groups with ON DELETE CASCADE, and those cascades are foreign-key
// actions, which row security doesn't filter.
export const allowOwnerGroupDelete: Migration = {
  name: '20260918120000-allow-owner-group-delete',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.query(`CREATE POLICY groups_delete ON groups FOR DELETE USING (group_role(id) = 'owner')`);
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.query('DROP POLICY groups_delete ON groups');
  },
};
