import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { OauthCode } from '@ft/api-database';
import { API_KEY_SCOPES, canGrantApiKeyScope, isApiKeyScope, type ApiKeyScope } from '@ft/shared-contracts';
import { AbilityFactory } from '../_core/authz/ability.factory';
import { withRlsUser } from '../_core/rls/with-rls-user';
import { ApiKeysService } from '../api-keys/api-keys.service';
import {
  AuthorizationError,
  codeChallengeOf,
  isValidCodeVerifier,
  sameResource,
  validateAuthorization,
  withParams,
  type AuthorizationParams,
  type ValidAuthorization,
} from './oauth-authorization';
import { encodeClientId, parseRegistration, redirectIdentity } from './oauth-clients';
import { OauthSettings } from './oauth-settings';

// Long enough to get through the app's redirect and its server's call back, short enough that a
// code read off a screen or a log is useless by then.
const CODE_TTL_MS = 5 * 60 * 1000;

interface RedeemedCode {
  user_id: string;
  group_id: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[];
  time_zone: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  scope: string;
}

/** An error the token endpoint answers with, as RFC 6749 (section 5.2) words them. */
export class TokenError extends HttpException {
  constructor(error: string, description: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super({ error, error_description: description }, status);
  }
}

/**
 * OAuth sign-in for apps that read a group through the MCP endpoint, an AI assistant above all.
 *
 * It ends in an ordinary API key: allowing an app makes a one-time code, and the app trades the
 * code for a key of its own, with viewing scopes and whatever else the person ticked. The key is listed with the group's other
 * keys, under the app's name, and deleting it there disconnects the app. It doesn't expire —
 * nothing here hands out refresh tokens — so it works until it's deleted, like any key made in the
 * app without an expiry, or until the same app signs in to the group again and gets a new one.
 */
@Injectable()
export class OauthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OauthCode) private readonly codes: Repository<OauthCode>,
    private readonly settings: OauthSettings,
    private readonly abilities: AbilityFactory,
    private readonly apiKeys: ApiKeysService,
  ) {}

  /** RFC 7591's response: the client id, which carries the registration itself. */
  register(body: unknown) {
    this.settings.require();
    const client = parseRegistration(body);
    return {
      client_id: encodeClientId(client, this.settings.clientSigningKey),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  /** The request, checked; throws AuthorizationError. */
  authorize(params: AuthorizationParams): ValidAuthorization {
    const { resource } = this.settings.require();
    return validateAuthorization(params, { signingKey: this.settings.clientSigningKey, resource });
  }

  /** What the consent page shows. A request it can't take is a 400 with the reason. */
  describe(params: AuthorizationParams) {
    const request = this.authorizeOrBadRequest(params);
    return {
      clientName: request.client.name,
      redirectHost: hostOf(request.redirectUri),
      scopes: request.scopes,
      optionalScopes: request.optionalScopes,
      denyUrl: withParams(request.redirectUri, { error: 'access_denied', state: request.state }),
    };
  }

  /** The person said yes: a code for the app, on the way back to it, for viewing and what they ticked. */
  async approve(
    userId: string,
    params: AuthorizationParams & { groupId: string; timeZone?: string; extraScopes?: ApiKeyScope[] },
  ): Promise<string> {
    const request = this.authorizeOrBadRequest(params);
    const unasked = (params.extraScopes ?? []).filter((scope) => !request.optionalScopes.includes(scope));
    if (unasked.length > 0) {
      throw new BadRequestException(`The app didn't ask for ${unasked.join(', ')}`);
    }
    const scopes = API_KEY_SCOPES.filter((scope) => request.scopes.includes(scope) || params.extraScopes?.includes(scope));
    // Also the 404 for a group the person isn't in.
    const { ability } = await this.abilities.forGroup(userId, params.groupId);
    const refused = scopes.filter((scope) => !canGrantApiKeyScope(ability, scope));
    if (refused.length > 0) {
      throw new ForbiddenException(`Your role in this group can't grant ${refused.join(', ')}`);
    }

    const code = randomBytes(32).toString('base64url');
    await this.codes.insert({
      codeHash: hashOf(code),
      groupId: params.groupId,
      userId,
      clientId: request.clientId,
      clientName: request.client.name,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scopes,
      timeZone: params.timeZone ?? null,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    return withParams(request.redirectUri, { code, state: request.state, iss: this.settings.require().issuer });
  }

  /**
   * The app trades its code for a key (RFC 6749, section 4.1.3, with PKCE). The code is used up by
   * the attempt, good or not: a second try, by the app or anyone who saw the code, gets nothing.
   */
  async exchange(params: Record<string, unknown>): Promise<TokenResponse> {
    const { resource } = this.settings.require();
    const read = (name: string) => (typeof params[name] === 'string' ? (params[name] as string) : undefined);
    if (read('grant_type') !== 'authorization_code') {
      throw new TokenError('unsupported_grant_type', 'Only grant_type=authorization_code is supported');
    }
    const code = read('code');
    const clientId = read('client_id');
    const verifier = read('code_verifier');
    if (!code || !clientId || !verifier) {
      throw new TokenError('invalid_request', 'code, client_id and code_verifier are required');
    }

    const rows: RedeemedCode[] = await this.dataSource.query(
      'SELECT user_id, group_id, client_id, client_name, redirect_uri, code_challenge, scopes, time_zone FROM redeem_oauth_code($1)',
      [hashOf(code)],
    );
    const [redeemed] = rows;
    if (!redeemed || redeemed.client_id !== clientId) {
      throw new TokenError('invalid_grant', 'The code is unknown, used already or expired');
    }
    const redirectUri = read('redirect_uri');
    if (redirectUri !== undefined && redirectUri !== redeemed.redirect_uri) {
      throw new TokenError('invalid_grant', "redirect_uri isn't the one the code was issued for");
    }
    if (!isValidCodeVerifier(verifier) || codeChallengeOf(verifier) !== redeemed.code_challenge) {
      throw new TokenError('invalid_grant', "code_verifier doesn't match the code's challenge");
    }
    const target = read('resource');
    if (target !== undefined && !sameResource(target, resource)) {
      throw new TokenError('invalid_target', `This server signs apps in to ${resource} only`);
    }

    const scopes = redeemed.scopes.filter(isApiKeyScope) as ApiKeyScope[];
    // The trade has no identity of its own; the key is made as the person who allowed the app, under
    // the same rules as one they'd make in the app. It replaces the key this app had in the group.
    const { token } = await withRlsUser(this.dataSource, redeemed.user_id, () =>
      this.apiKeys.create(redeemed.user_id, redeemed.group_id, {
        name: redeemed.client_name,
        scopes,
        timeZone: redeemed.time_zone ?? undefined,
        oauthApp: { clientName: redeemed.client_name, redirectUri: redirectIdentity(redeemed.redirect_uri) },
      }),
    );
    return { access_token: token, token_type: 'Bearer', scope: scopes.join(' ') };
  }

  private authorizeOrBadRequest(params: AuthorizationParams): ValidAuthorization {
    try {
      return this.authorize(params);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}

function hashOf(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// What the consent page names the app by: a loopback redirect is an app on the person's own device.
function hostOf(uri: string): string {
  const url = new URL(uri);
  return url.host || url.protocol.replace(/:$/, '');
}
