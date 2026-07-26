// Mirrors the default_values rows from
// `migrations/02 - Seed currencies, templates for categories and accounts.sql` — kept as code,
// not a DB table, same reasoning as the account/category templates (see
// local/plans/02-development-plan.md, phase 5 decision).
export const DEFAULT_VALUES = {
  language: 'en',
  currencyId: 1, // USD — see libs/api/database/src/migrations/20260725220000-seed-currencies.ts
  groupName: 'My Group',
} as const;
