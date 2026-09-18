import { defineAbilityFor } from '../authz/ability.js';
import { API_KEY_SCOPES, canGrantApiKeyScope } from './api-key-scopes.js';

describe('canGrantApiKeyScope', () => {
  it('lets a member grant every scope', () => {
    const ability = defineAbilityFor({ role: 'member', archived: false });
    expect(API_KEY_SCOPES.every((scope) => canGrantApiKeyScope(ability, scope))).toBe(true);
  });

  it('lets a viewer grant reading only', () => {
    const ability = defineAbilityFor({ role: 'viewer', archived: false });
    const grantable = API_KEY_SCOPES.filter((scope) => canGrantApiKeyScope(ability, scope));
    expect(grantable).toEqual(['transactions:read', 'accounts:read', 'categories:read']);
  });

  it('keeps an archived group read-only, for its owner too', () => {
    const ability = defineAbilityFor({ role: 'owner', archived: true });
    expect(canGrantApiKeyScope(ability, 'transactions:read')).toBe(true);
    expect(canGrantApiKeyScope(ability, 'transactions:create')).toBe(false);
  });
});
