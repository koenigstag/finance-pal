import { defineAbilityFor } from '../authz/ability.js';
import { API_KEY_READ_SCOPES, API_KEY_SCOPES, apiKeyScope, canGrantApiKeyScope } from './api-key-scopes.js';

describe('canGrantApiKeyScope', () => {
  it('lets a member grant every scope', () => {
    const ability = defineAbilityFor({ role: 'member', archived: false });
    expect(API_KEY_SCOPES.every((scope) => canGrantApiKeyScope(ability, scope))).toBe(true);
  });

  it('lets a viewer grant reading only', () => {
    const ability = defineAbilityFor({ role: 'viewer', archived: false });
    const grantable = API_KEY_SCOPES.filter((scope) => canGrantApiKeyScope(ability, scope));
    expect(grantable).toEqual(['transactions:read', 'accounts:read', 'categories:read', 'budgets:read']);
  });

  it('keeps an archived group read-only, for its owner too', () => {
    const ability = defineAbilityFor({ role: 'owner', archived: true });
    expect(canGrantApiKeyScope(ability, 'transactions:read')).toBe(true);
    expect(canGrantApiKeyScope(ability, 'transactions:create')).toBe(false);
    expect(canGrantApiKeyScope(ability, 'transactions:delete')).toBe(false);
  });
});

describe('apiKeyScope', () => {
  it('names the scope for an access to a resource', () => {
    expect(apiKeyScope('budgets', 'read')).toBe('budgets:read');
    expect(apiKeyScope('transactions', 'update')).toBe('transactions:update');
  });

  it('has deleting as an access of its own', () => {
    expect(apiKeyScope('accounts', 'delete')).toBe('accounts:delete');
  });
});

describe('API_KEY_READ_SCOPES', () => {
  it('is every way to view, and nothing else', () => {
    expect(API_KEY_READ_SCOPES).toEqual(['transactions:read', 'accounts:read', 'categories:read', 'budgets:read']);
  });
});
