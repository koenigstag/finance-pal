import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  id: string;
}

// Set on external API requests, alongside `user` — the key's owner, whom RLS then sees as the caller.
export interface RequestApiKey {
  id: string;
  userId: string;
  // The one group the key works in.
  groupId: string;
  scopes: string[];
}

export interface AuthenticatedRequest {
  user?: RequestUser;
  apiKey?: RequestApiKey;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);

export const CurrentApiKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestApiKey | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().apiKey,
);
