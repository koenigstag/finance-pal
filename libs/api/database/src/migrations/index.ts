import type { Migration } from './migration.interface.js';
import { createAuthTables } from './20260725193215-create-auth-tables.js';
import { createDomainSchema } from './20260725210000-create-domain-schema.js';

export const migrations: readonly Migration[] = [createAuthTables, createDomainSchema];

export * from './migration.interface.js';
export * from './migrator.js';
