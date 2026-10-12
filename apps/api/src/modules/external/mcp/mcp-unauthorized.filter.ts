import { Catch, HttpStatus, Injectable, UnauthorizedException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OauthSettings } from '../../oauth/oauth-settings';

/**
 * The MCP endpoint's 401, which is also how an assistant learns where to sign in: the
 * WWW-Authenticate header points at the endpoint's protected resource metadata (RFC 9728), which
 * names this API as the server that signs apps in. Without OAuth set up it's a plain Bearer
 * challenge, and only API keys made in the app get in.
 */
@Catch(UnauthorizedException)
@Injectable()
export class McpUnauthorizedFilter implements ExceptionFilter {
  constructor(private readonly settings: OauthSettings) {}

  catch(exception: UnauthorizedException, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const params: string[] = [];
    if (this.settings.endpoints) {
      params.push(`resource_metadata="${this.settings.endpoints.resourceMetadata}"`);
    }
    // RFC 6750: a request that carried a credential is told it wasn't good; one that didn't, just
    // asked for one.
    if (request.headers.authorization || request.headers['x-api-key']) {
      params.push('error="invalid_token"');
    }
    response
      .status(HttpStatus.UNAUTHORIZED)
      .setHeader('WWW-Authenticate', params.length > 0 ? `Bearer ${params.join(', ')}` : 'Bearer')
      .json({ statusCode: HttpStatus.UNAUTHORIZED, message: exception.message });
  }
}
