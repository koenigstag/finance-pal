import type { Repository } from 'typeorm';
import type { ApiKey } from '@ft/api-database';
import { defineAbilityFor } from '@ft/shared-contracts';
import type { AbilityFactory } from '../_core/authz/ability.factory';
import { ApiKeysService } from './api-keys.service';

// @Transactional() needs a data source to run in; these calls only need the method's own logic.
jest.mock('typeorm-transactional', () => ({ Transactional: () => () => undefined }));

function setup() {
  const repository = {
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    create: jest.fn((row: Partial<ApiKey>) => row),
    save: jest.fn(async (row: Partial<ApiKey>) => ({ id: 'key-new', ...row })),
  };
  const abilities = { forGroup: jest.fn().mockResolvedValue({ ability: defineAbilityFor({ role: 'member', archived: false }) }) };
  const service = new ApiKeysService(repository as unknown as Repository<ApiKey>, abilities as unknown as AbilityFactory);
  return { service, repository };
}

describe('ApiKeysService.create', () => {
  it('leaves other keys alone when making one in the app', async () => {
    const { service, repository } = setup();
    const { apiKey } = await service.create('user-1', 'group-1', { name: 'Claude', scopes: ['transactions:read'] });
    expect(repository.delete).not.toHaveBeenCalled();
    expect(apiKey).toMatchObject({ oauthClientName: null, oauthRedirectUri: null });
  });

  it("replaces the key a signed-in app had, and only that app's, before making its new one", async () => {
    const { service, repository } = setup();
    const oauthApp = { clientName: 'Claude', redirectUri: 'https://claude.ai/api/mcp/auth_callback' };
    const { apiKey } = await service.create('user-1', 'group-1', { name: 'Claude', scopes: ['transactions:read'], oauthApp });
    expect(repository.delete).toHaveBeenCalledWith({
      groupId: 'group-1',
      userId: 'user-1',
      oauthClientName: 'Claude',
      oauthRedirectUri: 'https://claude.ai/api/mcp/auth_callback',
    });
    expect(repository.delete.mock.invocationCallOrder[0]).toBeLessThan(repository.save.mock.invocationCallOrder[0]);
    expect(apiKey).toMatchObject({ oauthClientName: 'Claude', oauthRedirectUri: oauthApp.redirectUri });
  });
});
