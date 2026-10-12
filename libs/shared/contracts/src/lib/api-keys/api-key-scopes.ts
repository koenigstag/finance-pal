import { z } from 'zod';
import type { AppAbility, Subject } from '../authz/ability.js';

// What an API key may touch, and how. There is no delete: a key lives in another app, often on a
// phone, and whatever it could erase is better erased here, by a person.
export const API_KEY_RESOURCES = ['transactions', 'accounts', 'categories', 'budgets'] as const;
export type ApiKeyResource = (typeof API_KEY_RESOURCES)[number];

export const API_KEY_ACCESS_LEVELS = ['read', 'create', 'update'] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS_LEVELS)[number];

// Budgets are only read, by an assistant asked how the month is going: setting them is planning,
// which stays in the app.
export const API_KEY_SCOPES = [
  'transactions:read',
  'transactions:create',
  'transactions:update',
  'accounts:read',
  'accounts:create',
  'accounts:update',
  'categories:read',
  'categories:create',
  'categories:update',
  'budgets:read',
] as const satisfies readonly `${ApiKeyResource}:${ApiKeyAccess}`[];
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);

// Everything a key can view and nothing it can change: what an app connected through sign-in gets.
export const API_KEY_READ_SCOPES = API_KEY_SCOPES.filter((scope) => scope.endsWith(':read'));

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}

/** The scope for this access to this resource, or null where there is none (budgets:create). */
export function apiKeyScope(resource: ApiKeyResource, access: ApiKeyAccess): ApiKeyScope | null {
  const scope = `${resource}:${access}`;
  return isApiKeyScope(scope) ? scope : null;
}

const SUBJECTS: Record<ApiKeyResource, Subject> = {
  transactions: 'Transaction',
  accounts: 'Account',
  categories: 'Category',
  budgets: 'Budget',
};

/**
 * Whether someone with this ability in a group can give a key of theirs the scope: a key never
 * does more than its owner may. Every request is held to the owner's role at that moment anyway;
 * this only keeps a key from being made with access it could never use.
 */
export function canGrantApiKeyScope(ability: AppAbility, scope: ApiKeyScope): boolean {
  const [resource, access] = scope.split(':') as [ApiKeyResource, ApiKeyAccess];
  return ability.can(access, SUBJECTS[resource]);
}
