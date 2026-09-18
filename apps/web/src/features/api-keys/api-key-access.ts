import {
  API_KEY_ACCESS_LEVELS,
  API_KEY_RESOURCES,
  API_KEY_SCOPES,
  apiKeyScope,
  type ApiKeyAccess,
  type ApiKeyResource,
  type ApiKeyScope,
} from '@ft/shared-contracts';

/** A key's scopes per resource, in the order the form lists them; resources it can't touch left out. */
export function accessByResource(scopes: readonly ApiKeyScope[]): { resource: ApiKeyResource; access: ApiKeyAccess[] }[] {
  return API_KEY_RESOURCES.map((resource) => ({
    resource,
    access: API_KEY_ACCESS_LEVELS.filter((access) => scopes.includes(apiKeyScope(resource, access))),
  })).filter(({ access }) => access.length > 0);
}

// Kept in the contract's order, so a key's scopes read the same wherever they're listed.
export function withScope(scopes: readonly ApiKeyScope[], scope: ApiKeyScope, granted: boolean): ApiKeyScope[] {
  return API_KEY_SCOPES.filter((candidate) => (candidate === scope ? granted : scopes.includes(candidate)));
}

export const EXPIRY_OPTIONS = ['never', '30', '90', '365'] as const;
export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];

/** When a key made now with this option stops working; undefined for never. */
export function expiresAtFor(option: ExpiryOption, now = new Date()): string | undefined {
  if (option === 'never') {
    return undefined;
  }
  return new Date(now.getTime() + Number(option) * 24 * 60 * 60 * 1000).toISOString();
}

// Where other apps send their requests: the API's own origin when the app is served from
// elsewhere (GitHub Pages), otherwise this page's, whose /api the dev server or proxy forwards.
export function externalApiBaseUrl(apiOrigin: string, pageOrigin: string): string {
  return `${apiOrigin || pageOrigin}/api/external/v1`;
}

/** A request to try the key with, the shape a phone automation sends. */
export function exampleRequest(baseUrl: string, token: string, accountName: string): string {
  const body = JSON.stringify({ type: 'expense', amount: '12.50', accountName, note: 'Coffee' });
  return [
    `curl -X POST ${baseUrl}/transactions \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '${body.replace(/'/g, `'\\''`)}'`,
  ].join('\n');
}
