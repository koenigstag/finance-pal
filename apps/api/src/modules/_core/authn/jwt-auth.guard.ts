import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { apiKeyRouteOf } from './api-key-auth.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedRequest } from './request-user';

interface AccessTokenPayload {
  sub: string;
}

// Registered globally, so every route is authenticated unless explicitly marked @Public().
// Safe to run as a guard (i.e. before the RLS transaction is opened by the interceptor)
// precisely because it never touches the database — it only verifies the token signature.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    // The external API authenticates with API keys instead, in ApiKeyAuthGuard. Skipping here is
    // what keeps an access token from working there, just as that guard ignores every other route.
    if (apiKeyRouteOf(this.reflector, context)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      // Covers expiry, bad signature and malformed tokens alike — the client has no
      // legitimate use for knowing which, and saying so helps token forgery attempts.
      throw new UnauthorizedException('Invalid access token');
    }

    request.user = { id: payload.sub };
    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) {
      return null;
    }
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
