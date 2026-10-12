import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import type { OauthCode } from '@ft/api-database';
import { defineAbilityFor } from '@ft/shared-contracts';
import type { AbilityFactory } from '../_core/authz/ability.factory';
import type { ApiKeysService } from '../api-keys/api-keys.service';
import { codeChallengeOf } from './oauth-authorization';
import { OauthService, TokenError } from './oauth.service';
import { OauthSettings } from './oauth-settings';

// The trade runs as the person who allowed the app; the transaction it would open is the database's.
jest.mock('../_core/rls/with-rls-user', () => ({
  withRlsUser: (_dataSource: unknown, _userId: string, fn: () => Promise<unknown>) => fn(),
}));

const env: Record<string, string> = {
  PUBLIC_API_URL: 'https://api.example.com',
  WEB_APP_URL: 'https://example.github.io/app',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
};
const settingsFrom = (values: Record<string, string>) =>
  new OauthSettings({ get: (name: string) => values[name] } as unknown as ConstructorParameters<typeof OauthSettings>[0]);
const settings = settingsFrom(env);
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
const groupId = '11111111-1111-4111-8111-111111111111';
const verifier = randomBytes(32).toString('base64url');

function setup(role: 'owner' | 'viewer' = 'owner') {
  const inserted: Partial<OauthCode>[] = [];
  const codes = { insert: jest.fn(async (row: Partial<OauthCode>) => inserted.push(row)) };
  const query = jest.fn();
  const create = jest.fn().mockResolvedValue({ apiKey: {}, token: 'fpk_issued' });
  const abilities = { forGroup: jest.fn().mockResolvedValue({ ability: defineAbilityFor({ role, archived: false }) }) };
  const service = new OauthService(
    { query } as unknown as DataSource,
    codes as unknown as Repository<OauthCode>,
    settings,
    abilities as unknown as AbilityFactory,
    { create } as unknown as ApiKeysService,
  );
  const { client_id: clientId } = service.register({ client_name: 'Claude', redirect_uris: [redirectUri] });
  const params = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallengeOf(verifier),
    code_challenge_method: 'S256',
    state: 'xyz',
  };
  return { service, inserted, query, create, clientId, params };
}

describe('OauthService', () => {
  it('describes the request for the consent page', () => {
    const { service, params } = setup();
    expect(service.describe(params)).toEqual({
      clientName: 'Claude',
      redirectHost: 'claude.ai',
      scopes: ['transactions:read', 'accounts:read', 'categories:read', 'budgets:read'],
      denyUrl: `${redirectUri}?error=access_denied&state=xyz`,
    });
  });

  it('turns a request it can’t take into a 400 for the consent page', () => {
    const { service, params } = setup();
    expect(() => service.describe({ ...params, code_challenge_method: 'plain' })).toThrow(BadRequestException);
  });

  it('sends the person back with a code and the state, keeping only its hash', async () => {
    const { service, inserted, params } = setup();
    const back = new URL(await service.approve('user-1', { ...params, groupId, timeZone: 'Europe/Kyiv' }));
    expect(back.origin + back.pathname).toBe(redirectUri);
    expect(back.searchParams.get('state')).toBe('xyz');
    expect(back.searchParams.get('iss')).toBe('https://api.example.com');
    const code = back.searchParams.get('code') ?? '';
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ userId: 'user-1', groupId, clientName: 'Claude', timeZone: 'Europe/Kyiv' });
    expect(JSON.stringify(inserted[0])).not.toContain(code);
  });

  it('lets a viewer connect an app: it only views', async () => {
    const { service, params } = setup('viewer');
    await expect(service.approve('user-1', { ...params, groupId })).resolves.toContain('code=');
  });

  describe('exchange', () => {
    const redeemed = (clientId: string) => ({
      user_id: 'user-1',
      group_id: groupId,
      client_id: clientId,
      client_name: 'Claude',
      redirect_uri: redirectUri,
      code_challenge: codeChallengeOf(verifier),
      scopes: ['accounts:read', 'budgets:read'],
      time_zone: 'Europe/Kyiv',
    });

    it('trades a good code for a read-only key, made as the person who allowed it', async () => {
      const { service, query, create, clientId } = setup();
      query.mockResolvedValue([redeemed(clientId)]);
      await expect(
        service.exchange({
          grant_type: 'authorization_code',
          code: 'the-code',
          client_id: clientId,
          redirect_uri: redirectUri,
          code_verifier: verifier,
          resource: 'https://api.example.com/api/mcp',
        }),
      ).resolves.toEqual({ access_token: 'fpk_issued', token_type: 'Bearer', scope: 'accounts:read budgets:read' });
      expect(query).toHaveBeenCalledWith(expect.stringContaining('redeem_oauth_code'), [expect.stringMatching(/^[0-9a-f]{64}$/)]);
      expect(create).toHaveBeenCalledWith('user-1', groupId, {
        name: 'Claude',
        scopes: ['accounts:read', 'budgets:read'],
        timeZone: 'Europe/Kyiv',
        // So it replaces the key Claude had here before.
        oauthApp: { clientName: 'Claude', redirectUri },
      });
    });

    it.each<[string, Record<string, string>, string]>([
      ['the wrong verifier', { code_verifier: randomBytes(32).toString('base64url') }, 'invalid_grant'],
      ['another redirect', { redirect_uri: 'https://claude.ai/other' }, 'invalid_grant'],
      ['another resource', { resource: 'https://other.example.com/mcp' }, 'invalid_target'],
      ['another grant type', { grant_type: 'refresh_token' }, 'unsupported_grant_type'],
      ['no verifier', { code_verifier: '' }, 'invalid_request'],
    ])('refuses %s, making no key', async (_label, overrides, error) => {
      const { service, query, create, clientId } = setup();
      query.mockResolvedValue([redeemed(clientId)]);
      const attempt = service.exchange({
        grant_type: 'authorization_code',
        code: 'the-code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        ...overrides,
      });
      await expect(attempt).rejects.toThrow(TokenError);
      await attempt.catch((caught: TokenError) => expect(caught.getResponse()).toMatchObject({ error }));
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses a code that is used, expired or unknown', async () => {
      const { service, query, clientId } = setup();
      query.mockResolvedValue([]);
      await expect(
        service.exchange({ grant_type: 'authorization_code', code: 'old', client_id: clientId, code_verifier: verifier }),
      ).rejects.toMatchObject({ response: { error: 'invalid_grant' } });
    });

    it('refuses a code made for another client', async () => {
      const { service, query, clientId } = setup();
      const { client_id: other } = service.register({ client_name: 'Other', redirect_uris: [redirectUri] });
      query.mockResolvedValue([redeemed(other)]);
      await expect(
        service.exchange({ grant_type: 'authorization_code', code: 'c', client_id: clientId, code_verifier: verifier }),
      ).rejects.toMatchObject({ response: { error: 'invalid_grant' } });
    });
  });

  it('says sign-in isn’t set up when it isn’t', () => {
    const bare = settingsFrom({ JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET });
    expect(bare.endpoints).toBeNull();
    expect(() => bare.require()).toThrow(/isn't set up/);
  });

  it('keeps an approval within what the role may grant', async () => {
    const { service, params } = setup();
    // A role that may grant nothing at all, which no real role is.
    const none = { can: () => false };
    (service as unknown as { abilities: AbilityFactory }).abilities = {
      forGroup: jest.fn().mockResolvedValue({ ability: none }),
    } as unknown as AbilityFactory;
    await expect(service.approve('user-1', { ...params, groupId })).rejects.toThrow(ForbiddenException);
  });
});
