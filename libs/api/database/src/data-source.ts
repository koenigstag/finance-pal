import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as models from './models/index.js';

type EntityClass = new (...args: never[]) => unknown;

// Entities are ES classes, enums (also exported from ./models) compile to plain objects —
// this filters the barrel down to just the classes without a list to keep in sync by hand.
function isEntityClass(value: unknown): value is EntityClass {
  return typeof value === 'function';
}

// cast to unknown[] first so the predicate's `S extends T` constraint isn't fighting the
// wide union of classes-and-enums that Object.values(models) infers
const entities = (Object.values(models) as unknown[]).filter(isEntityClass);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function createDataSource(url: string): DataSource {
  return new DataSource({ type: 'postgres', url, synchronize: false, entities });
}

// Runtime connection. DATABASE_URL must point at a role that does NOT own the tables —
// a table's owner bypasses that table's RLS policies, which would disable every access
// rule in the schema.
export const dataSource = createDataSource(requireEnv('DATABASE_URL'));

// Migrations connect as the schema owner instead, deliberately bypassing RLS: seeding
// reference data and backfilling columns must not be filtered by end-user policies.
// Falls back to DATABASE_URL so a single-role setup still works.
export function createMigrationDataSource(): DataSource {
  return createDataSource(process.env.MIGRATION_DATABASE_URL ?? requireEnv('DATABASE_URL'));
}
