import type { QueryRunner } from 'typeorm';
import type { RunnableMigration } from 'umzug';

export interface Migration extends RunnableMigration<QueryRunner> {
  // Postgres forbids some DDL (e.g. CREATE INDEX CONCURRENTLY) inside a transaction block.
  // Set to false to run this migration's up()/down() outside the runner's BEGIN/COMMIT —
  // atomicity between the DDL and the migrations_history record is then not guaranteed.
  transactional?: boolean;
}
