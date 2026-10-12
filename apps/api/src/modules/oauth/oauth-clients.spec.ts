import {
  RegistrationError,
  decodeClientId,
  encodeClientId,
  isAllowedRedirectUri,
  isRegisteredRedirect,
  parseRegistration,
  redirectIdentity,
} from './oauth-clients';

const key = Buffer.from('k'.repeat(32));
const claude = { name: 'Claude', redirectUris: ['https://claude.ai/api/mcp/auth_callback'] };

describe('parseRegistration', () => {
  it('reads what an assistant registers with', () => {
    expect(
      parseRegistration({
        client_name: ' Claude ',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
      }),
    ).toEqual(claude);
  });

  it('names a client that gives no name', () => {
    expect(parseRegistration({ redirect_uris: ['http://localhost:3118/callback'] }).name).toBe('An app');
  });

  it('refuses a registration without somewhere to send the code', () => {
    expect(() => parseRegistration({ client_name: 'X' })).toThrow(RegistrationError);
    expect(() => parseRegistration({ redirect_uris: [] })).toThrow(RegistrationError);
    expect(() => parseRegistration(null)).toThrow(RegistrationError);
  });

  it('refuses a redirect it would not send a browser to', () => {
    expect(() => parseRegistration({ redirect_uris: ['https://ok.example/cb', 'javascript:alert(1)'] })).toThrow(
      /javascript:alert\(1\) can't be a redirect URI/,
    );
  });
});

describe('client ids', () => {
  it('carry the registration back', () => {
    expect(decodeClientId(encodeClientId(claude, key), key)).toEqual(claude);
  });

  it("aren't taken when signed with another key", () => {
    expect(decodeClientId(encodeClientId(claude, key), Buffer.from('x'.repeat(32)))).toBeNull();
  });

  it("can't be altered to name another redirect", () => {
    const [payload, signature] = encodeClientId(claude, key).slice(4).split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), r: ['https://evil.example/cb'] }),
    ).toString('base64url');
    expect(decodeClientId(`fpc_${forged}.${signature}`, key)).toBeNull();
  });

  it.each(['', 'fpc_', 'fpc_abc', 'fpc_a.b.c', 'other_abc.def'])('turn away %j', (clientId) => {
    expect(decodeClientId(clientId, key)).toBeNull();
  });

  it('refuse a registration too long to travel in a link', () => {
    const uris = Array.from({ length: 10 }, (_, i) => `https://example.com/${'x'.repeat(300)}/${i}`);
    expect(() => encodeClientId({ name: 'Long', redirectUris: uris }, key)).toThrow(RegistrationError);
  });
});

describe('isAllowedRedirectUri', () => {
  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'http://localhost:3118/callback',
    'http://127.0.0.1:50000/cb',
    'http://[::1]:8080/cb',
    'com.example.app:/oauth/callback',
  ])('takes %s', (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it.each([
    'http://claude.ai/callback',
    'https://claude.ai/callback#fragment',
    'javascript:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'cursor://callback',
    'not a url',
  ])('refuses %s', (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });
});

describe('isRegisteredRedirect', () => {
  const desktop = { name: 'Claude Code', redirectUris: ['http://localhost:3118/callback'] };

  it('takes the redirect registered', () => {
    expect(isRegisteredRedirect(claude, 'https://claude.ai/api/mcp/auth_callback')).toBe(true);
  });

  it('takes a loopback redirect on another port', () => {
    expect(isRegisteredRedirect(desktop, 'http://localhost:51234/callback')).toBe(true);
  });

  it('refuses anything else', () => {
    expect(isRegisteredRedirect(claude, 'https://claude.ai/api/mcp/auth_callback/')).toBe(false);
    expect(isRegisteredRedirect(desktop, 'http://localhost:51234/other')).toBe(false);
    expect(isRegisteredRedirect(desktop, 'http://127.0.0.1:3118/callback')).toBe(false);
  });
});

describe('redirectIdentity', () => {
  it('knows a desktop app again whatever port it listens on', () => {
    expect(redirectIdentity('http://localhost:51234/callback')).toBe(redirectIdentity('http://localhost:3118/callback'));
  });

  it('keeps any other redirect as it is', () => {
    expect(redirectIdentity('https://claude.ai/api/mcp/auth_callback')).toBe('https://claude.ai/api/mcp/auth_callback');
  });
});
