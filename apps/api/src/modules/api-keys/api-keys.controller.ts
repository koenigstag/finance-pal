import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiKeysContract, type ApiKeyScope } from '@ft/shared-contracts';
import type { ApiKey } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { ApiKeysService } from './api-keys.service';

function toApiKeyDto(apiKey: ApiKey) {
  return {
    id: apiKey.id,
    groupId: apiKey.groupId,
    name: apiKey.name,
    tokenPrefix: apiKey.tokenPrefix,
    // Only ever written from the contract's list, by ApiKeysService.
    scopes: apiKey.scopes as ApiKeyScope[],
    expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
  };
}

// Managing keys takes an access token — the web app's session — never a key: a key that could
// mint keys would outlive every attempt to revoke it.
@Controller()
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @TsRestHandler(apiKeysContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(apiKeysContract.list, async ({ params }) => {
      const apiKeys = await this.apiKeys.list(requireUser(user).id, params.groupId);
      return { status: 200 as const, body: apiKeys.map(toApiKeyDto) };
    });
  }

  @TsRestHandler(apiKeysContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(apiKeysContract.create, async ({ params, body }) => {
      const { apiKey, token } = await this.apiKeys.create(requireUser(user).id, params.groupId, body);
      return { status: 201 as const, body: { apiKey: toApiKeyDto(apiKey), token } };
    });
  }

  @TsRestHandler(apiKeysContract.update)
  update(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(apiKeysContract.update, async ({ params, body }) => {
      const apiKey = await this.apiKeys.update(requireUser(user).id, params.groupId, params.apiKeyId, body);
      return { status: 200 as const, body: toApiKeyDto(apiKey) };
    });
  }

  @TsRestHandler(apiKeysContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(apiKeysContract.remove, async ({ params }) => {
      const apiKey = await this.apiKeys.remove(requireUser(user).id, params.groupId, params.apiKeyId);
      return { status: 200 as const, body: toApiKeyDto(apiKey) };
    });
  }
}
