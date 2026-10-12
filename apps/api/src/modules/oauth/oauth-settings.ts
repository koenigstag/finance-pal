import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { Env } from '../_core/config/env.schema';

// The MCP endpoint, which OAuth sign-in is for: the protected resource, in OAuth's terms.
export const MCP_PATH = '/api/mcp';

export const OAUTH_PATHS = {
  register: '/api/oauth/register',
  authorize: '/api/oauth/authorize',
  token: '/api/oauth/token',
  // RFC 8414 and RFC 9728: where clients look, at the root of the origin, for what they need.
  authorizationServerMetadata: '/.well-known/oauth-authorization-server',
  protectedResourceMetadata: '/.well-known/oauth-protected-resource',
} as const;

export interface OauthEndpoints {
  // The API's public origin, which names it as the authorization server.
  issuer: string;
  // The MCP endpoint's URL, as people enter it in the app that connects.
  resource: string;
  resourceMetadata: string;
  authorization: string;
  token: string;
  registration: string;
  // The web app's page that asks the person.
  consentPage: string;
}

/**
 * Where OAuth sign-in lives, from PUBLIC_API_URL and WEB_APP_URL, or null when they aren't set: then
 * the MCP endpoint takes API keys only, and the sign-in routes say sign-in isn't set up.
 */
@Injectable()
export class OauthSettings {
  readonly endpoints: OauthEndpoints | null;
  /**
   * What client ids are signed with (see oauth-clients.ts). Derived from the access token secret
   * rather than one more secret to deploy, and under its own label, so neither can stand in for the
   * other: a client id can't pass for an access token. Rotating that secret signs everyone out of
   * the web app; connected apps keep their keys and only need to register again to sign in anew.
   */
  readonly clientSigningKey: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const api = config.get('PUBLIC_API_URL', { infer: true });
    const web = config.get('WEB_APP_URL', { infer: true });
    this.endpoints =
      api && web
        ? {
            issuer: api,
            resource: `${api}${MCP_PATH}`,
            resourceMetadata: `${api}${OAUTH_PATHS.protectedResourceMetadata}${MCP_PATH}`,
            authorization: `${api}${OAUTH_PATHS.authorize}`,
            token: `${api}${OAUTH_PATHS.token}`,
            registration: `${api}${OAUTH_PATHS.register}`,
            consentPage: `${web}/oauth/consent`,
          }
        : null;
    this.clientSigningKey = createHmac('sha256', config.get('JWT_ACCESS_SECRET', { infer: true }))
      .update('finance-pal/oauth-client-id')
      .digest();
  }

  require(): OauthEndpoints {
    if (!this.endpoints) {
      throw new ServiceUnavailableException("Sign-in for other apps isn't set up on this server");
    }
    return this.endpoints;
  }
}
