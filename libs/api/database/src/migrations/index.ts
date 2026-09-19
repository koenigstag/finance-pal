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
import { createApiKeys } from './20260918180000-create-api-keys.js';
import { addTransactionIdempotency } from './20260918190000-add-transaction-idempotency.js';
import { keepOnePlannedOccurrence } from './20260918200000-keep-one-planned-occurrence.js';
import { addTransactionPercentage } from './20260918180000-add-transaction-percentage.js';
import { addTransactionPercentageBase } from './20260918190000-add-transaction-percentage-base.js';
import { addPercentageToSeries } from './20260918210000-add-percentage-to-series.js';
import { addBalanceRounding } from './20260919120000-add-balance-rounding.js';
import { allowZeroEstimates } from './20260919150000-allow-zero-estimates.js';
import { addExchangeRatesCache } from './20260919160000-add-exchange-rates-cache.js';
import { addTransactionDestAmountAsOf } from './20260919170000-add-transaction-dest-amount-as-of.js';

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
  createApiKeys,
  addTransactionIdempotency,
  keepOnePlannedOccurrence,
  // Written alongside the three above on another branch, and stamped among them. Migrations are
  // known by name and run in this list's order, so these come last: where the others are applied
  // already, they're the ones pending.
  addTransactionPercentage,
  addTransactionPercentageBase,
  addPercentageToSeries,
  addBalanceRounding,
  allowZeroEstimates,
  addExchangeRatesCache,
  addTransactionDestAmountAsOf,
];

export * from './migration.interface.js';
export * from './migrator.js';
