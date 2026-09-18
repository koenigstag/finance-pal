import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AppRoute } from '@ts-rest/core';
import type { ApiKeyScope, ExternalRouteMetadata } from '@ft/shared-contracts';

export const API_KEY_ROUTE_KEY = 'ft:apiKeyRoute';

export interface ApiKeyRoute {
  // null: any valid key.
  scope: ApiKeyScope | null;
}

/**
 * Makes a handler part of the external API: callers authenticate with an API key, not an access
 * token, and the key needs the scope the contract route declares in its metadata — the contract
 * is where a client reads it too, so the two can't disagree.
 *
 * Per handler, deliberately not per controller: a handler without it is an ordinary route that
 * wants an access token, so forgetting it locks keys out rather than letting any key in.
 */
export function ApiKeyAuth(route: AppRoute): MethodDecorator {
  const metadata = route.metadata as ExternalRouteMetadata | undefined;
  if (metadata?.scope === undefined) {
    // At startup, when the controller class is evaluated: a route with no scope isn't one to guess about.
    throw new Error(`${route.method} ${route.path} declares no API key scope in its metadata`);
  }
  return SetMetadata(API_KEY_ROUTE_KEY, { scope: metadata.scope } satisfies ApiKeyRoute);
}

// Read from the handler only, matching where ApiKeyAuth puts it.
export function apiKeyRouteOf(reflector: Reflector, context: ExecutionContext): ApiKeyRoute | undefined {
  return reflector.get<ApiKeyRoute | undefined>(API_KEY_ROUTE_KEY, context.getHandler());
}
