import { Controller } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { Repository } from 'typeorm';
import { ApiKey, Group } from '@ft/api-database';
import { externalContract, type ApiKeyScope } from '@ft/shared-contracts';
import { ApiKeyAuth } from '../_core/authn/api-key-auth.decorator';
import { CurrentApiKey, type RequestApiKey } from '../_core/authn/request-user';
import { requireApiKey } from '../_core/authn/require-api-key';
import { AbilityFactory } from '../_core/authz/ability.factory';

// What an integration checks first: that its key works, where, and with what it may do there.
@Controller()
export class ExternalKeyController {
  constructor(
    @InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    private readonly abilities: AbilityFactory,
  ) {}

  @ApiKeyAuth(externalContract.key)
  @TsRestHandler(externalContract.key)
  key(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(externalContract.key, async () => {
      const { id, userId, groupId } = requireApiKey(apiKey);
      // The request runs as the key's owner, whom RLS lets see their own key and their group.
      const key = await this.apiKeys.findOneByOrFail({ id });
      const { role, archived } = await this.abilities.forGroup(userId, groupId);
      const group = await this.groups.findOneByOrFail({ id: groupId });
      return {
        status: 200 as const,
        body: {
          id: key.id,
          name: key.name,
          scopes: key.scopes as ApiKeyScope[],
          expiresAt: key.expiresAt?.toISOString() ?? null,
          group: { id: group.id, name: group.name, role, archived },
        },
      };
    });
  }
}
