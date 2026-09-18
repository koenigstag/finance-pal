import { UnauthorizedException } from '@nestjs/common';
import type { RequestApiKey } from './request-user';

// ApiKeyAuthGuard sets request.apiKey on every @ApiKeyAuth route, so this should be unreachable —
// the same safety net requireUser() is for access tokens.
export function requireApiKey(apiKey: RequestApiKey | undefined): RequestApiKey {
  if (!apiKey) {
    throw new UnauthorizedException('Missing API key');
  }
  return apiKey;
}
