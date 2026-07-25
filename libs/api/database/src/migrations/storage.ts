import type { QueryRunner } from 'typeorm';
import type { UmzugStorage } from 'umzug';

export const MIGRATIONS_TABLE = 'migrations_history';

// Bootstraps the history table itself — must run before any storage call,
// outside of a per-migration transaction (the table has to exist first).
export async function ensureMigrationsTable(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name text PRIMARY KEY,
      run_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

// Writes/reads the log on whatever QueryRunner the migration itself ran on —
// the runner passes the same queryRunner as `context`, so the log entry commits
// (or rolls back) atomically with the migration's own DDL.
export const typeOrmStorage: UmzugStorage<QueryRunner> = {
  async logMigration({ name, context: queryRunner }) {
    await queryRunner.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [name]);
  },
  async unlogMigration({ name, context: queryRunner }) {
    await queryRunner.query(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = $1`, [name]);
  },
  async executed({ context: queryRunner }) {
    const rows: Array<{ name: string }> = await queryRunner.query(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`);
    return rows.map((row) => row.name);
  },
};
