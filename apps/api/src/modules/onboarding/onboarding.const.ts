// Mirrors the default_values rows from
// `migrations/02 - Seed currencies, templates for categories and accounts.sql` that are still
// relevant — kept as code, not a DB table, same reasoning as the account/category templates
// (see local/plans/02-development-plan.md, phase 5 decision). `default_group_name` isn't here:
// group creation isn't part of onboarding anymore (POST /groups already takes an explicit
// name), so there's no seeding call left that needs a default to fall back to.
export const DEFAULT_VALUES = {
  language: 'en',
  currencyId: 1, // USD — see libs/api/database/src/migrations/20260725220000-seed-currencies.ts
} as const;

// The two fields that gate isOnboarded/missingFields — see the migration that added them.
// A future onboarding field only needs adding here (and as a nullable column) for existing
// profiles to automatically re-enter "not onboarded" until they fill it in too.
export const ONBOARDING_REQUIRED_FIELDS = ['displayName', 'startDayOfWeek'] as const;
