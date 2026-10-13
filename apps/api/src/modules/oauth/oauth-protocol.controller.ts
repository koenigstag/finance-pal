import { Body, Controller, Get, HttpCode, HttpException, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { API_KEY_SCOPES } from '@ft/shared-contracts';
import { Public } from '../_core/authn/public.decorator';
import { AuthorizationError, authorizationParams } from './oauth-authorization';
import { RegistrationError } from './oauth-clients';
import { OauthService, TokenError } from './oauth.service';
import { MCP_PATH, OAUTH_PATHS, OauthSettings } from './oauth-settings';

/**
 * The OAuth routes other apps call, outside the ts-rest contracts: they take form bodies and
 * redirects, and answer errors in OAuth's own shape (RFC 6749, 7591, 8414, 9728) rather than the
 * app's. All public: the app calling them has no session, and the consent itself happens in the
 * web app, signed in.
 */
@Controller()
@Public()
export class OauthProtocolController {
  constructor(
    private readonly oauth: OauthService,
    private readonly settings: OauthSettings,
  ) {}

  // RFC 8414: what an app needs to sign in here.
  @Get(OAUTH_PATHS.authorizationServerMetadata)
  authorizationServer() {
    const endpoints = this.settings.require();
    return {
      issuer: endpoints.issuer,
      authorization_endpoint: endpoints.authorization,
      token_endpoint: endpoints.token,
      registration_endpoint: endpoints.registration,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: API_KEY_SCOPES,
      // RFC 9207: the redirect back names this server, so an app signed in at several can tell.
      authorization_response_iss_parameter_supported: true,
    };
  }

  // RFC 9728: who signs apps in to the MCP endpoint. Also answered at the bare path, which some
  // clients ask first.
  @Get([OAUTH_PATHS.protectedResourceMetadata, `${OAUTH_PATHS.protectedResourceMetadata}${MCP_PATH}`])
  protectedResource() {
    const endpoints = this.settings.require();
    return {
      resource: endpoints.resource,
      authorization_servers: [endpoints.issuer],
      scopes_supported: API_KEY_SCOPES,
      bearer_methods_supported: ['header'],
      resource_name: 'Finance Pal',
    };
  }

  @Post(OAUTH_PATHS.register)
  @HttpCode(201)
  register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    try {
      return this.oauth.register(body);
    } catch (error) {
      if (error instanceof RegistrationError) {
        throw new HttpException({ error: error.error, error_description: error.message }, 400);
      }
      throw error;
    }
  }

  /**
   * Where the app sends the person's browser. A good request goes on to the web app's consent page
   * as it came; a bad one stops here, with a page saying why (see AuthorizationError).
   */
  @Get(OAUTH_PATHS.authorize)
  authorize(@Query() query: Record<string, unknown>, @Req() request: Request, @Res() response: Response): void {
    const endpoints = this.settings.endpoints;
    if (!endpoints) {
      response.status(503).type('text/plain').send("Sign-in for other apps isn't set up on this server.");
      return;
    }
    try {
      this.oauth.authorize(authorizationParams(query));
    } catch (error) {
      if (!(error instanceof AuthorizationError)) {
        throw error;
      }
      response.status(400).type('text/plain').send(`Finance Pal can't sign this app in: ${error.message}. Start connecting again from the app.`);
      return;
    }
    // The query exactly as it came, which the consent page passes back to be checked again.
    const search = new URL(request.originalUrl, 'http://localhost').search;
    response.redirect(302, `${endpoints.consentPage}${search}`);
  }

  // Form-encoded, as RFC 6749 has it; JSON is taken too.
  @Post(OAUTH_PATHS.token)
  @HttpCode(200)
  async token(@Body() body: Record<string, unknown> | undefined, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    try {
      return await this.oauth.exchange(body ?? {});
    } catch (error) {
      // The other failures, a group gone or a role lost since the code was made, are the code being
      // no good any more, as far as the app can do anything about it.
      if (error instanceof TokenError || !(error instanceof HttpException) || error.getStatus() >= 500) {
        throw error;
      }
      throw new TokenError('invalid_grant', error.message);
    }
  }
}
