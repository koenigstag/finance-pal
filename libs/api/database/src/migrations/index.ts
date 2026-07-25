import type { Migration } from './migration.interface.js';
import { createAuthTables } from './20260725193215-create-auth-tables.js';

export const migrations: readonly Migration[] = [createAuthTables];

export * from './migration.interface.js';
export * from './migrator.js';
