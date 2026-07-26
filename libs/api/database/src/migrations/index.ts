import type { Migration } from './migration.interface.js';
import { createAuthTables } from './20260725193215-create-auth-tables.js';
import { createDomainSchema } from './20260725210000-create-domain-schema.js';
import { seedCurrencies } from './20260725220000-seed-currencies.js';
import { enableRowLevelSecurity } from './20260726120000-enable-rls.js';
import { fixGroupsSelectOwnerVisibility } from './20260726130000-fix-groups-select-owner-visibility.js';

export const migrations: readonly Migration[] = [
  createAuthTables,
  createDomainSchema,
  seedCurrencies,
  enableRowLevelSecurity,
  fixGroupsSelectOwnerVisibility,
];

export * from './migration.interface.js';
export * from './migrator.js';
