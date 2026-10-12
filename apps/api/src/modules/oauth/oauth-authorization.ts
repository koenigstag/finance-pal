import { createHash } from 'node:crypto';
import { API_KEY_READ_SCOPES, isApiKeyScope, type ApiKeyScope } from '@ft/shared-contracts';
import { decodeClientId, isRegisteredRedirect, type OauthClient } from './oauth-clients';

/** An authorization request's parameters as they came: strings, or missing. */
export interface AuthorizationParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

export interface ValidAuthorization {
  clientId: string;
  client: OauthClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | undefined;
  scopes: ApiKeyScope[];
}

/**
 * Why an authorization request can't go ahead. The person is told, on a page of the API's own,
 * rather than the app at its redirect: anyone may register a client with any redirect, so sending
 * the browser there unasked would let any link pass through this domain to any site (RFC 9700,
 * section 4.11.2). Only the person's own answer on the consent page sends them back to the app.
 */
export class AuthorizationError extends Error {
  constructor(
    readonly error: string,
    description: string,
  ) {
    super(description);
  }
}

// S256 of 32 random bytes, as RFC 7636 has clients make it: 43 base64url characters.
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Every query value as a string, or undefined: a parameter given twice counts as not given. */
export function authorizationParams(query: Record<string, unknown>): AuthorizationParams {
  const read = (name: keyof AuthorizationParams) => (typeof query[name] === 'string' ? (query[name] as string) : undefined);
  return {
    response_type: read('response_type'),
    client_id: read('client_id'),
    redirect_uri: read('redirect_uri'),
    code_challenge: read('code_challenge'),
    code_challenge_method: read('code_challenge_method'),
    state: read('state'),
    scope: read('scope'),
    resource: read('resource'),
  };
}

/**
 * Checks an authorization request: the client and its redirect, then the rest. Only the code flow
 * with PKCE S256 is taken, as OAuth 2.1 and MCP require.
 */
export function validateAuthorization(
  params: AuthorizationParams,
  { signingKey, resource }: { signingKey: Buffer; resource: string },
): ValidAuthorization {
  const client = params.client_id ? decodeClientId(params.client_id, signingKey) : null;
  if (!client || !params.client_id) {
    throw new AuthorizationError('invalid_client', "The app's client id isn't one this server registered");
  }
  // Left out, the one the client registered, if it registered just one.
  const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !isRegisteredRedirect(client, redirectUri)) {
    throw new AuthorizationError('invalid_request', "The app asked to be sent back somewhere it didn't register");
  }
  if (params.response_type !== 'code') {
    throw new AuthorizationError('unsupported_response_type', 'Only response_type=code is supported');
  }
  if (params.code_challenge_method !== 'S256' || !params.code_challenge || !CODE_CHALLENGE_PATTERN.test(params.code_challenge)) {
    throw new AuthorizationError('invalid_request', 'PKCE is required: send a code_challenge with code_challenge_method=S256');
  }
  if (params.resource !== undefined && !sameResource(params.resource, resource)) {
    throw new AuthorizationError('invalid_target', `This server signs apps in to ${resource} only`);
  }

  return {
    clientId: params.client_id,
    client,
    redirectUri,
    codeChallenge: params.code_challenge,
    state: params.state,
    scopes: grantedScopes(params.scope),
  };
}

/**
 * What an app gets to see: the viewing scopes it asks for, or all of them when it asks for none
 * this server knows — the scope request is the app's wish, which RFC 6749 lets the server narrow
 * or fill in (section 3.3). Asking for more than viewing never gets more.
 */
export function grantedScopes(scope: string | undefined): ApiKeyScope[] {
  const asked = new Set((scope ?? '').split(' ').filter(isApiKeyScope));
  const granted = API_KEY_READ_SCOPES.filter((candidate) => asked.has(candidate));
  return granted.length > 0 ? granted : [...API_KEY_READ_SCOPES];
}

// The same URL, give or take a trailing slash, which people add or leave off when they paste one.
export function sameResource(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}

/** The URL with these query parameters added, those that are undefined left out. */
export function withParams(uri: string, params: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(name, value);
    }
  }
  return url.toString();
}

/** PKCE S256: base64url of the verifier's SHA-256, which must equal the request's challenge. */
export function codeChallengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

// RFC 7636: 43 to 128 characters from the URL's unreserved set.
export function isValidCodeVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier);
}
