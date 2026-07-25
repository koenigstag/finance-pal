import type { DataSource, QueryRunner } from 'typeorm';
import { Umzug } from 'umzug';
import type { Migration } from './migration.interface.js';
import { ensureMigrationsTable, typeOrmStorage } from './storage.js';

async function withQueryRunner<T>(dataSource: DataSource, fn: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    return await fn(queryRunner);
  } finally {
    await queryRunner.release();
  }
}

// A fresh Umzug instance per call, scoped to a single QueryRunner — this is what makes
// "transaction per migration" possible: Umzug's `context` is fixed at construction, so the
// only way to give each migration its own transaction is to build a new instance around it.
function buildUmzug(migrations: readonly Migration[], queryRunner: QueryRunner): Umzug<QueryRunner> {
  return new Umzug<QueryRunner>({
    migrations: [...migrations],
    context: queryRunner,
    storage: typeOrmStorage,
    logger: console,
  });
}

async function runOne(dataSource: DataSource, migrations: readonly Migration[], migration: Migration, direction: 'up' | 'down'): Promise<void> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  const transactional = migration.transactional !== false;

  try {
    if (transactional) {
      await queryRunner.startTransaction();
    }

    const umzug = buildUmzug(migrations, queryRunner);
    if (direction === 'up') {
      await umzug.up({ migrations: [migration.name] });
    } else {
      await umzug.down({ migrations: [migration.name] });
    }

    if (transactional) {
      await queryRunner.commitTransaction();
    }
  } catch (error) {
    if (transactional && queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    throw error;
  } finally {
    await queryRunner.release();
  }
}

function findMigration(migrations: readonly Migration[], name: string): Migration {
  const migration = migrations.find((candidate) => candidate.name === name);
  if (!migration) {
    throw new Error(`Migration "${name}" is not registered`);
  }
  return migration;
}

// Applies all pending migrations, one transaction each. If migration N fails, migrations
// 1..N-1 stay committed — only N and the rest remain pending for the next run.
export async function migrateUp(dataSource: DataSource, migrations: readonly Migration[]): Promise<void> {
  await withQueryRunner(dataSource, (queryRunner) => ensureMigrationsTable(queryRunner));

  const pending = await withQueryRunner(dataSource, (queryRunner) => buildUmzug(migrations, queryRunner).pending());

  for (const meta of pending) {
    await runOne(dataSource, migrations, findMigration(migrations, meta.name), 'up');
  }
}

// Reverts executed migrations newest-first, one transaction each, down to and including `to`
// (or just the single most recent migration if `to` is omitted).
export async function migrateDown(dataSource: DataSource, migrations: readonly Migration[], options: { to?: string } = {}): Promise<void> {
  const executed = await withQueryRunner(dataSource, (queryRunner) => buildUmzug(migrations, queryRunner).executed());
  const toRevert = [...executed].reverse();

  for (const meta of toRevert) {
    await runOne(dataSource, migrations, findMigration(migrations, meta.name), 'down');

    if (options.to === undefined || meta.name === options.to) {
      break;
    }
  }
}
