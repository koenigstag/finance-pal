import { randomBytes } from 'node:crypto';
import {
  AuthorizationError,
  authorizationParams,
  codeChallengeOf,
  grantedScopes,
  isValidCodeVerifier,
  validateAuthorization,
  type AuthorizationParams,
} from './oauth-authorization';
import { encodeClientId } from './oauth-clients';

const signingKey = Buffer.from('k'.repeat(32));
const resource = 'https://api.example.com/api/mcp';
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
const clientId = encodeClientId({ name: 'Claude', redirectUris: [redirectUri] }, signingKey);
const verifier = randomBytes(32).toString('base64url');

const request = (overrides: Partial<AuthorizationParams> = {}): AuthorizationParams => ({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  code_challenge: codeChallengeOf(verifier),
  code_challenge_method: 'S256',
  state: 'xyz',
  scope: 'accounts:read transactions:read',
  resource,
  ...overrides,
});

function errorOf(params: AuthorizationParams): AuthorizationError {
  try {
    validateAuthorization(params, { signingKey, resource });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the request to be refused');
}

describe('validateAuthorization', () => {
  it('takes the request an assistant sends', () => {
    expect(validateAuthorization(request(), { signingKey, resource })).toEqual({
      clientId,
      client: { name: 'Claude', redirectUris: [redirectUri] },
      redirectUri,
      codeChallenge: codeChallengeOf(verifier),
      state: 'xyz',
      scopes: ['transactions:read', 'accounts:read'],
    });
  });

  it('takes the resource with a trailing slash, and none at all', () => {
    expect(() => validateAuthorization(request({ resource: `${resource}/` }), { signingKey, resource })).not.toThrow();
    expect(() => validateAuthorization(request({ resource: undefined }), { signingKey, resource })).not.toThrow();
  });

  it('falls back to the one redirect the client registered', () => {
    expect(validateAuthorization(request({ redirect_uri: undefined }), { signingKey, resource }).redirectUri).toBe(redirectUri);
  });

  it.each<[string, Partial<AuthorizationParams>, string]>([
    ['a client it never registered', { client_id: 'fpc_forged.sig' }, 'invalid_client'],
    ["a redirect the client didn't register", { redirect_uri: 'https://evil.example/cb' }, 'invalid_request'],
    ['another response type', { response_type: 'token' }, 'unsupported_response_type'],
    ['no PKCE', { code_challenge: undefined, code_challenge_method: undefined }, 'invalid_request'],
    ['a malformed challenge', { code_challenge: 'short' }, 'invalid_request'],
    ['another resource', { resource: 'https://other.example.com/mcp' }, 'invalid_target'],
  ])('refuses %s', (_label, overrides, code) => {
    expect(errorOf(request(overrides)).error).toBe(code);
  });
});

describe('grantedScopes', () => {
  it('grants the viewing scopes asked for', () => {
    expect(grantedScopes('budgets:read accounts:read')).toEqual(['accounts:read', 'budgets:read']);
  });

  it('grants every viewing scope when asked for none it knows', () => {
    expect(grantedScopes(undefined)).toEqual(['transactions:read', 'accounts:read', 'categories:read', 'budgets:read']);
    expect(grantedScopes('openid profile')).toEqual(['transactions:read', 'accounts:read', 'categories:read', 'budgets:read']);
  });

  it('never grants more than viewing', () => {
    expect(grantedScopes('transactions:create transactions:read')).toEqual(['transactions:read']);
  });
});

describe('authorizationParams', () => {
  it('drops a parameter given twice', () => {
    expect(authorizationParams({ client_id: ['a', 'b'], state: 's' })).toMatchObject({ client_id: undefined, state: 's' });
  });
});

describe('PKCE', () => {
  it("matches RFC 7636's example", () => {
    expect(codeChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it.each([
    ['too short', 'a'.repeat(42), false],
    ['too long', 'a'.repeat(129), false],
    ['outside the unreserved set', `${'a'.repeat(43)}+`, false],
    ['well formed', 'a'.repeat(43), true],
  ])('reads a verifier %s', (_label, value, valid) => {
    expect(isValidCodeVerifier(value)).toBe(valid);
  });
});
