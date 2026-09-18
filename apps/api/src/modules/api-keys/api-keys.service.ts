import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { ApiKey } from '@ft/api-database';
import { canGrantApiKeyScope, type ApiKeyScope, type AppAbility } from '@ft/shared-contracts';
import { AbilityFactory } from '../_core/authz/ability.factory';
import { generateApiKey } from '../_core/authn/api-key-token';

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: string;
}

export interface UpdateApiKeyInput {
  name?: string;
  scopes?: ApiKeyScope[];
}

/**
 * A member's own keys for a group. Anyone in the group may have keys — a viewer's can only read —
 * and nobody sees anyone else's, not even the group's owner: the RLS policy on api_keys hides
 * them, whatever these queries ask for. The filters on userId below say the same thing in code.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>,
    private readonly abilities: AbilityFactory,
  ) {}

  async list(userId: string, groupId: string): Promise<ApiKey[]> {
    // 404 for a group the caller isn't in, like every other group-scoped read.
    await this.abilities.forGroup(userId, groupId);
    return this.apiKeys.find({ where: { groupId, userId }, order: { createdAt: 'DESC' } });
  }

  /** Returns the key itself alongside its row: the one moment it exists outside its hash. */
  @Transactional()
  async create(userId: string, groupId: string, input: CreateApiKeyInput): Promise<{ apiKey: ApiKey; token: string }> {
    const { ability } = await this.abilities.forGroup(userId, groupId);
    const scopes = grantable(ability, input.scopes);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    const { token, tokenHash, tokenPrefix } = generateApiKey();
    const apiKey = await this.apiKeys.save(
      this.apiKeys.create({
        groupId,
        userId,
        name: input.name,
        tokenHash,
        tokenPrefix,
        scopes,
        expiresAt,
        // Explicit rather than left to the column default: save() hands back this object.
        lastUsedAt: null,
      }),
    );
    return { apiKey, token };
  }

  @Transactional()
  async update(userId: string, groupId: string, apiKeyId: string, patch: UpdateApiKeyInput): Promise<ApiKey> {
    const { ability } = await this.abilities.forGroup(userId, groupId);
    await this.findOrFail(userId, groupId, apiKeyId);

    const changes: Partial<Pick<ApiKey, 'name' | 'scopes'>> = {};
    if (patch.name !== undefined) {
      changes.name = patch.name;
    }
    if (patch.scopes !== undefined) {
      changes.scopes = grantable(ability, patch.scopes);
    }
    if (Object.keys(changes).length > 0) {
      await this.apiKeys.update({ id: apiKeyId, groupId, userId }, changes);
    }
    return this.findOrFail(userId, groupId, apiKeyId);
  }

  // Always allowed, in an archived group too: taking a key out of use is never the risky direction.
  @Transactional()
  async remove(userId: string, groupId: string, apiKeyId: string): Promise<ApiKey> {
    await this.abilities.forGroup(userId, groupId);
    const apiKey = await this.findOrFail(userId, groupId, apiKeyId);
    await this.apiKeys.delete({ id: apiKeyId, groupId, userId });
    return apiKey;
  }

  private async findOrFail(userId: string, groupId: string, apiKeyId: string): Promise<ApiKey> {
    const apiKey = await this.apiKeys.findOneBy({ id: apiKeyId, groupId, userId });
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }
    return apiKey;
  }
}

// A key gets no scope its owner couldn't use themselves: a viewer's key can only read, and so can
// any key in an archived group. Listing a scope twice is harmless and stored once.
function grantable(ability: AppAbility, scopes: ApiKeyScope[]): ApiKeyScope[] {
  const unique = [...new Set(scopes)];
  const refused = unique.filter((scope) => !canGrantApiKeyScope(ability, scope));
  if (refused.length > 0) {
    throw new ForbiddenException(`Your role in this group can't grant ${refused.join(', ')}`);
  }
  return unique;
}
