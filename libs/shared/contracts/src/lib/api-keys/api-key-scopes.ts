import { z } from 'zod';
import type { AppAbility, Subject } from '../authz/ability.js';

// What an API key may touch, and how. There is no delete: a key lives in another app, often on a
// phone, and whatever it could erase is better erased here, by a person.
export const API_KEY_RESOURCES = ['transactions', 'accounts', 'categories'] as const;
export type ApiKeyResource = (typeof API_KEY_RESOURCES)[number];

export const API_KEY_ACCESS_LEVELS = ['read', 'create', 'update'] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS_LEVELS)[number];

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
] as const satisfies readonly `${ApiKeyResource}:${ApiKeyAccess}`[];
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);

export function apiKeyScope(resource: ApiKeyResource, access: ApiKeyAccess): ApiKeyScope {
  return `${resource}:${access}`;
}

const SUBJECTS: Record<ApiKeyResource, Subject> = {
  transactions: 'Transaction',
  accounts: 'Account',
  categories: 'Category',
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
