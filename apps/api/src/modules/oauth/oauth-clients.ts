import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * An app registered for OAuth sign-in (RFC 7591, Dynamic Client Registration): its name, and where
 * it may be sent back to. AI assistants register themselves this way on every new connection.
 *
 * Nothing is stored. The client id carries the registration itself, signed, so anyone may register
 * without leaving rows behind, and the id can't be altered to name another redirect: a request
 * with an id the API didn't sign is refused like an unknown one.
 */
export interface OauthClient {
  name: string;
  redirectUris: string[];
}

const PREFIX = 'fpc_';
// What a registration may carry, as JSON: enough for a few redirect URIs, and short enough for the
// id to travel in the authorization link, whose whole length browsers and proxies limit.
const MAX_PAYLOAD_BYTES = 2048;
const MAX_NAME_LENGTH = 80;
const MAX_REDIRECT_URIS = 10;
const DEFAULT_NAME = 'An app';

export class RegistrationError extends Error {
  constructor(
    readonly error: 'invalid_redirect_uri' | 'invalid_client_metadata',
    description: string,
  ) {
    super(description);
  }
}

/** The client a registration request describes, or a RegistrationError saying what's wrong with it. */
export function parseRegistration(body: unknown): OauthClient {
  const metadata = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const uris = metadata.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || !uris.every((uri) => typeof uri === 'string')) {
    throw new RegistrationError('invalid_redirect_uri', 'redirect_uris must list at least one URI');
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    throw new RegistrationError('invalid_redirect_uri', `redirect_uris may list up to ${MAX_REDIRECT_URIS} URIs`);
  }
  const refused = uris.find((uri) => !isAllowedRedirectUri(uri));
  if (refused !== undefined) {
    throw new RegistrationError(
      'invalid_redirect_uri',
      `${refused} can't be a redirect URI: use https, http on a loopback address, or an app's own reverse-domain scheme`,
    );
  }
  // RFC 7591 leaves the method to the server: every client here is a public one, proving itself
  // with PKCE rather than a secret, which an app on a person's device couldn't keep anyway.
  const name = typeof metadata.client_name === 'string' ? metadata.client_name.trim() : '';
  return { name: name.slice(0, MAX_NAME_LENGTH) || DEFAULT_NAME, redirectUris: [...new Set(uris as string[])] };
}

export function encodeClientId(client: OauthClient, key: Buffer): string {
  const json = JSON.stringify({ n: client.name, r: client.redirectUris });
  if (Buffer.byteLength(json) > MAX_PAYLOAD_BYTES) {
    throw new RegistrationError('invalid_client_metadata', 'The registration is too long: list fewer or shorter redirect URIs');
  }
  const payload = Buffer.from(json).toString('base64url');
  return `${PREFIX}${payload}.${sign(payload, key)}`;
}

/** The client an id names, or null for one the API didn't sign. */
export function decodeClientId(clientId: string, key: Buffer): OauthClient | null {
  if (!clientId.startsWith(PREFIX)) {
    return null;
  }
  const [payload, signature, ...rest] = clientId.slice(PREFIX.length).split('.');
  if (!payload || !signature || rest.length > 0) {
    return null;
  }
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  try {
    const { n, r } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { n: unknown; r: unknown };
    if (typeof n !== 'string' || !Array.isArray(r) || !r.every((uri) => typeof uri === 'string')) {
      return null;
    }
    return { name: n, redirectUris: r };
  } catch {
    return null;
  }
}

function sign(payload: string, key: Buffer): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// Schemes a page could run or read files with, whatever the app claiming them says.
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:']);

/**
 * Where an app may be sent back to, with its code: https anywhere; plain http only to the same
 * device, where a desktop app listens for it (RFC 8252); or an app's private scheme, named after a
 * domain it owns (com.example.app:/callback). Never a fragment, which would hide the code from the
 * app's server, and never a scheme that runs code in the page navigating there.
 */
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || uri.includes('#') || UNSAFE_SCHEMES.has(url.protocol)) {
    return false;
  }
  if (url.protocol === 'https:') {
    return true;
  }
  if (url.protocol === 'http:') {
    return LOOPBACK_HOSTS.has(url.hostname);
  }
  return /^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+:$/.test(url.protocol);
}

/**
 * Whether the redirect an authorization request names is one the client registered: the same
 * string, or for a loopback address the same but for the port, which a desktop app picks anew
 * each time it listens (RFC 8252, section 7.3).
 */
export function isRegisteredRedirect(client: OauthClient, requested: string): boolean {
  if (client.redirectUris.includes(requested)) {
    return true;
  }
  const loose = withoutLoopbackPort(requested);
  return loose !== null && client.redirectUris.some((uri) => withoutLoopbackPort(uri) === loose);
}

/**
 * The redirect as an app is known by from one sign-in to the next: as registered, but a loopback
 * one without its port, which a desktop app picks anew each time.
 */
export function redirectIdentity(uri: string): string {
  return withoutLoopbackPort(uri) ?? uri;
}

function withoutLoopbackPort(uri: string): string | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) {
      return null;
    }
    url.port = '';
    return url.toString();
  } catch {
    return null;
  }
}
