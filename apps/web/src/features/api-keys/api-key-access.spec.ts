import { describe, expect, it } from 'vitest';
import { accessByResource, exampleRequest, expiresAtFor, externalApiBaseUrl, withScope } from './api-key-access';

describe('accessByResource', () => {
  it('groups scopes per resource, in the form’s order', () => {
    expect(accessByResource(['categories:read', 'transactions:create', 'transactions:read'])).toEqual([
      { resource: 'transactions', access: ['read', 'create'] },
      { resource: 'categories', access: ['read'] },
    ]);
  });
});

describe('withScope', () => {
  it('adds in the contract’s order and removes', () => {
    const scopes = withScope(['accounts:read'], 'transactions:create', true);
    expect(scopes).toEqual(['transactions:create', 'accounts:read']);
    expect(withScope(scopes, 'accounts:read', false)).toEqual(['transactions:create']);
  });
});

describe('expiresAtFor', () => {
  it('counts days from now, or never', () => {
    const now = new Date('2026-09-18T12:00:00Z');
    expect(expiresAtFor('never', now)).toBeUndefined();
    expect(expiresAtFor('30', now)).toBe('2026-10-18T12:00:00.000Z');
  });
});

describe('externalApiBaseUrl', () => {
  it('prefers the API’s own origin', () => {
    expect(externalApiBaseUrl('https://api.example.com', 'https://app.example.com')).toBe('https://api.example.com/api/external/v1');
    expect(externalApiBaseUrl('', 'http://localhost:4200')).toBe('http://localhost:4200/api/external/v1');
  });
});

describe('exampleRequest', () => {
  it('quotes an account name with an apostrophe for the shell', () => {
    const request = exampleRequest('https://x/api/external/v1', 'fpk_x', "Mom's card");
    expect(request).toContain(`"accountName":"Mom'\\''s card"`);
  });
});
