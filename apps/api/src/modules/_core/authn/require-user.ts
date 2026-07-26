import { UnauthorizedException } from '@nestjs/common';
import type { RequestUser } from './request-user';

// JwtAuthGuard populates request.user for every non-@Public route, so this should be
// unreachable — it exists so the type is non-optional downstream without a cast that would
// silently produce `undefined.id` if the guard were ever detached from a controller.
export function requireUser(user: RequestUser | undefined): RequestUser {
  if (!user) {
    throw new UnauthorizedException('Missing authenticated user');
  }
  return user;
}
