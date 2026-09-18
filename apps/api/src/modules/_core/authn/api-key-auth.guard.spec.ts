import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { DataSource } from 'typeorm';
import { externalContract } from '@ft/shared-contracts';
import { ApiKeyAuth } from './api-key-auth.decorator';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { generateApiKey, hashApiKey } from './api-key-token';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { AuthenticatedRequest } from './request-user';

class Handlers {
  @ApiKeyAuth(externalContract.transactions.create)
  createTransaction() {
    return undefined;
  }

  @ApiKeyAuth(externalContract.key)
  describeKey() {
    return undefined;
  }

  internalRoute() {
    return undefined;
  }
}

type Request = AuthenticatedRequest & { headers: Record<string, string | undefined> };

function contextFor(handler: keyof Handlers, headers: Record<string, string> = {}): { context: ExecutionContext; request: Request } {
  const request: Request = { headers };
  const context = {
    getHandler: () => Handlers.prototype[handler],
    getClass: () => Handlers,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

const key = generateApiKey().token;
const row = { key_id: 'key-1', user_id: 'user-1', group_id: 'group-1', scopes: ['transactions:create'] };

function guardWith(rows: (typeof row)[]) {
  const query = jest.fn().mockResolvedValue(rows);
  const guard = new ApiKeyAuthGuard({ query } as unknown as DataSource, new Reflector());
  return { guard, query };
}

describe('ApiKeyAuthGuard', () => {
  it("leaves routes that aren't the external API to JwtAuthGuard", async () => {
    const { guard, query } = guardWith([row]);
    await expect(guard.canActivate(contextFor('internalRoute').context)).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('authenticates a key as its owner, in its group', async () => {
    const { guard, query } = guardWith([row]);
    const { context, request } = contextFor('createTransaction', { authorization: `Bearer ${key}` });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('authenticate_api_key'), [hashApiKey(key)]);
    expect(request.user).toEqual({ id: 'user-1' });
    expect(request.apiKey).toEqual({ id: 'key-1', userId: 'user-1', groupId: 'group-1', scopes: ['transactions:create'] });
  });

  it('takes the key from X-Api-Key too', async () => {
    const { guard } = guardWith([row]);
    await expect(guard.canActivate(contextFor('createTransaction', { 'x-api-key': key }).context)).resolves.toBe(true);
  });

  it('prefers X-Api-Key when Authorization carries something else', async () => {
    const { guard, query } = guardWith([row]);
    const { context } = contextFor('createTransaction', { authorization: 'Basic dXNlcjpwYXNz', 'x-api-key': key });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.any(String), [hashApiKey(key)]);
  });

  it('refuses a request without a key', async () => {
    const { guard } = guardWith([row]);
    await expect(guard.canActivate(contextFor('createTransaction').context)).rejects.toThrow('Missing API key');
  });

  it('turns away an access token without a lookup', async () => {
    const { guard, query } = guardWith([row]);
    const { context } = contextFor('createTransaction', { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig' });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses a key the database doesn’t know — unknown, deleted or expired', async () => {
    const { guard } = guardWith([]);
    const { context } = contextFor('createTransaction', { authorization: `Bearer ${key}` });
    await expect(guard.canActivate(context)).rejects.toThrow('Invalid API key');
  });

  it("refuses a key without the route's scope", async () => {
    const { guard } = guardWith([{ ...row, scopes: ['transactions:read'] }]);
    const { context } = contextFor('createTransaction', { authorization: `Bearer ${key}` });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('lets any key describe itself', async () => {
    const { guard } = guardWith([{ ...row, scopes: ['accounts:read'] }]);
    await expect(guard.canActivate(contextFor('describeKey', { authorization: `Bearer ${key}` }).context)).resolves.toBe(true);
  });
});

describe('JwtAuthGuard', () => {
  it('leaves the external API to ApiKeyAuthGuard, so an access token opens nothing there', async () => {
    const verifyAsync = jest.fn();
    const guard = new JwtAuthGuard({ verifyAsync } as unknown as JwtService, new Reflector());
    await expect(guard.canActivate(contextFor('createTransaction').context)).resolves.toBe(true);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('still wants an access token everywhere else, a key included', async () => {
    const verifyAsync = jest.fn().mockRejectedValue(new Error('invalid signature'));
    const guard = new JwtAuthGuard({ verifyAsync } as unknown as JwtService, new Reflector());
    const { context } = contextFor('internalRoute', { authorization: `Bearer ${key}` });
    await expect(guard.canActivate(context)).rejects.toThrow('Invalid access token');
  });
});

describe('ApiKeyAuth', () => {
  it('refuses a contract route that declares no scope', () => {
    expect(() => ApiKeyAuth({ method: 'GET', path: '/somewhere', responses: {} })).toThrow(/declares no API key scope/);
  });
});
