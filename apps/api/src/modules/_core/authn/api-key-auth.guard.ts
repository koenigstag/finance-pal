import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { apiKeyRouteOf } from './api-key-auth.decorator';
import { hashApiKey, isWellFormedApiKey } from './api-key-token';
import type { AuthenticatedRequest, RequestApiKey } from './request-user';

interface AuthenticatedKeyRow {
  key_id: string;
  user_id: string;
  group_id: string;
  scopes: string[];
}

/**
 * Authenticates the external API's routes, those marked @ApiKeyAuth, and leaves every other route
 * to JwtAuthGuard — which skips these in turn, so an access token opens nothing here and a key
 * nothing there. Registered globally, like JwtAuthGuard, so no controller can forget it.
 *
 * Unlike JwtAuthGuard this reads the database: a key is a random string until its row is found.
 * It does so before RlsContextInterceptor opens the request's transaction, with no identity set,
 * through authenticate_api_key() — the one SECURITY DEFINER function allowed to find a key by its
 * hash. Everything after that runs under RLS as the key's owner, put on request.user exactly as an
 * access token would put its subject.
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const route = apiKeyRouteOf(this.reflector, context);
    if (!route) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const token = extractApiKey(request);
    if (!token) {
      throw new UnauthorizedException('Missing API key');
    }

    const apiKey = isWellFormedApiKey(token) ? await this.authenticate(token) : null;
    if (!apiKey) {
      // Unknown, deleted and expired keys alike: which one it was is of no use to a legitimate caller.
      throw new UnauthorizedException('Invalid API key');
    }
    if (route.scope !== null && !apiKey.scopes.includes(route.scope)) {
      throw new ForbiddenException(`This API key lacks the ${route.scope} scope`);
    }

    request.user = { id: apiKey.userId };
    request.apiKey = apiKey;
    return true;
  }

  private async authenticate(token: string): Promise<RequestApiKey | null> {
    const rows: AuthenticatedKeyRow[] = await this.dataSource.query(
      'SELECT key_id, user_id, group_id, scopes FROM authenticate_api_key($1)',
      [hashApiKey(token)],
    );
    const [row] = rows;
    return row ? { id: row.key_id, userId: row.user_id, groupId: row.group_id, scopes: row.scopes } : null;
  }
}

// X-Api-Key or Authorization: Bearer, the former first — it can only mean a key for this API,
// while Authorization may already carry something else, such as a proxy's basic auth. Never the
// query string: URLs end up in proxy and server logs.
export function extractApiKey(request: Pick<Request, 'headers'>): string | null {
  const header = request.headers['x-api-key'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  const authorization = request.headers.authorization;
  return authorization ? (/^Bearer\s+(\S+)\s*$/i.exec(authorization)?.[1] ?? null) : null;
}
