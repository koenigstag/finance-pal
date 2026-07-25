import { Table, TableForeignKey, TableIndex, TableUnique } from 'typeorm';
import type { Migration } from './migration.interface.js';

export const createAuthTables: Migration = {
  name: '001-create-auth-tables',

  async up({ context: queryRunner }) {
    // users.email is citext — TypeORM would create this automatically on connect if any
    // loaded entity uses citext, but the migration stays self-contained rather than relying
    // on that side effect
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS citext');

    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'email', type: 'citext', isUnique: true },
          { name: 'password_hash', type: 'text', isNullable: true },
          { name: 'email_verified_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createTable(
      new Table({
        name: 'auth_identities',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'user_id', type: 'uuid' },
          { name: 'provider', type: 'text' },
          { name: 'provider_user_id', type: 'text' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'auth_identities',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createUniqueConstraint(
      'auth_identities',
      new TableUnique({
        name: 'uq_auth_identities_provider_user',
        columnNames: ['provider', 'provider_user_id'],
      }),
    );

    await queryRunner.createIndex(
      'auth_identities',
      new TableIndex({ name: 'idx_auth_identities_user', columnNames: ['user_id'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'refresh_tokens',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
          { name: 'user_id', type: 'uuid' },
          { name: 'family_id', type: 'uuid' },
          { name: 'token_hash', type: 'text', isUnique: true },
          { name: 'expires_at', type: 'timestamptz' },
          { name: 'revoked_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'refresh_tokens',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'refresh_tokens',
      new TableIndex({ name: 'idx_refresh_tokens_user', columnNames: ['user_id'] }),
    );

    await queryRunner.createIndex(
      'refresh_tokens',
      new TableIndex({ name: 'idx_refresh_tokens_family', columnNames: ['family_id'] }),
    );

    // Generic trigger function, reused by the domain migration for its own updated_at
    // columns too — defined here so it exists before anything needs it.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_users_updated
      BEFORE UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at()
    `);
  },

  async down({ context: queryRunner }) {
    await queryRunner.query('DROP TRIGGER IF EXISTS trg_users_updated ON users');
    await queryRunner.dropTable('refresh_tokens', true);
    await queryRunner.dropTable('auth_identities', true);
    await queryRunner.dropTable('users', true);
    // set_updated_at() is left in place: the domain migration may still depend on it
  },
};
