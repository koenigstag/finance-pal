import type { Migration } from './migration.interface.js';
import { createAuthTables } from './20260725193215-create-auth-tables.js';
import { createDomainSchema } from './20260725210000-create-domain-schema.js';
import { seedCurrencies } from './20260725220000-seed-currencies.js';
import { enableRowLevelSecurity } from './20260726120000-enable-rls.js';
import { fixGroupsSelectOwnerVisibility } from './20260726130000-fix-groups-select-owner-visibility.js';
import { addProfileOnboardingFields } from './20260726140000-add-profile-onboarding-fields.js';
import { addRecurringOccurrences } from './20260917120000-add-recurring-occurrences.js';
import { addRecurringRuleStartsAt } from './20260917130000-add-recurring-rule-starts-at.js';
import { allowOwnerGroupDelete } from './20260918120000-allow-owner-group-delete.js';
import { addProfileExchangeRates } from './20260918140000-add-profile-exchange-rates.js';
import { addTransactionSubcategory } from './20260918160000-add-transaction-subcategory.js';

export const migrations: readonly Migration[] = [
  createAuthTables,
  createDomainSchema,
  seedCurrencies,
  enableRowLevelSecurity,
  fixGroupsSelectOwnerVisibility,
  addProfileOnboardingFields,
  addRecurringOccurrences,
  addRecurringRuleStartsAt,
  allowOwnerGroupDelete,
  addProfileExchangeRates,
  addTransactionSubcategory,
];

export * from './migration.interface.js';
export * from './migrator.js';
