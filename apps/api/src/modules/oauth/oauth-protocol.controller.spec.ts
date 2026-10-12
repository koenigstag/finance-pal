import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import type { DataSource, Repository } from 'typeorm';
import type { OauthCode } from '@ft/api-database';
import type { AbilityFactory } from '../_core/authz/ability.factory';
import type { ApiKeysService } from '../api-keys/api-keys.service';
import { codeChallengeOf } from './oauth-authorization';
import { OauthProtocolController } from './oauth-protocol.controller';
import { OauthService } from './oauth.service';
import { OauthSettings } from './oauth-settings';

const env: Record<string, string> = {
  PUBLIC_API_URL: 'https://api.example.com',
  WEB_APP_URL: 'https://example.github.io/app',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
};
const settings = new OauthSettings({ get: (name: string) => env[name] } as unknown as ConstructorParameters<typeof OauthSettings>[0]);
const service = new OauthService(
  {} as DataSource,
  {} as Repository<OauthCode>,
  settings,
  {} as AbilityFactory,
  {} as ApiKeysService,
);
const controller = new OauthProtocolController(service, settings);
const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
const { client_id: clientId } = service.register({ client_name: 'Claude', redirect_uris: [redirectUri] });

function authorize(params: Record<string, string>) {
  const search = new URLSearchParams(params).toString();
  const sent: { status?: number; location?: string; body?: string } = {};
  const response = {
    redirect(status: number, location: string) {
      Object.assign(sent, { status, location });
    },
    status(status: number) {
      sent.status = status;
      return this;
    },
    type() {
      return this;
    },
    send(body: string) {
      sent.body = body;
    },
  } as unknown as Response;
  controller.authorize(params, { originalUrl: `/api/oauth/authorize?${search}` } as Request, response);
  return { ...sent, search };
}

const good = {
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  code_challenge: codeChallengeOf(randomBytes(32).toString('base64url')),
  code_challenge_method: 'S256',
  state: 'xyz',
};

describe('OauthProtocolController.authorize', () => {
  it('hands a good request on to the consent page, as it came', () => {
    const { status, location, search } = authorize(good);
    expect(status).toBe(302);
    expect(location).toBe(`https://example.github.io/app/oauth/consent?${search}`);
  });

  it.each([
    ['an unknown client', { client_id: 'fpc_forged.sig' }],
    ['an unregistered redirect', { redirect_uri: 'https://evil.example/cb' }],
    ['no PKCE', { code_challenge_method: 'plain' }],
  ])('stops %s on a page of its own, sending the browser nowhere', (_label, override) => {
    const { status, location, body } = authorize({ ...good, ...override });
    expect(status).toBe(400);
    expect(location).toBeUndefined();
    expect(body).toMatch(/^Finance Pal can't sign this app in/);
  });

  it('describes the server to apps that sign in', () => {
    expect(controller.authorizationServer()).toMatchObject({
      issuer: 'https://api.example.com',
      authorization_endpoint: 'https://api.example.com/api/oauth/authorize',
      token_endpoint: 'https://api.example.com/api/oauth/token',
      registration_endpoint: 'https://api.example.com/api/oauth/register',
      code_challenge_methods_supported: ['S256'],
    });
    expect(controller.protectedResource()).toMatchObject({
      resource: 'https://api.example.com/api/mcp',
      authorization_servers: ['https://api.example.com'],
    });
  });
});
