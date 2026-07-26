import { AccountType } from '@ft/api-database';

export interface AccountTemplate {
  key: string;
  sortOrder: number;
  name: string;
  icon: string;
  color: string | null;
  type: AccountType;
  lang: string;
}

// Mirrors the account_templates rows from
// `migrations/02 - Seed currencies, templates for categories and accounts.sql` — kept as code,
// not a DB table (see local/plans/02-development-plan.md, phase 5 decision).
export const ACCOUNT_TEMPLATES: readonly AccountTemplate[] = [
  { key: 'wallet', sortOrder: 1, name: 'Wallet', icon: 'wallet', color: null, type: AccountType.REGULAR, lang: 'en' },
  { key: 'wallet', sortOrder: 1, name: 'Кошелек', icon: 'wallet', color: null, type: AccountType.REGULAR, lang: 'ru' },
  { key: 'card', sortOrder: 2, name: 'Card', icon: 'card', color: null, type: AccountType.REGULAR, lang: 'en' },
  { key: 'card', sortOrder: 2, name: 'Карта', icon: 'card', color: null, type: AccountType.REGULAR, lang: 'ru' },
];
