import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { externalContract } from '@ft/shared-contracts';
import { ApiKeyAuth } from '../_core/authn/api-key-auth.decorator';
import { CurrentApiKey, type RequestApiKey } from '../_core/authn/request-user';
import { requireApiKey } from '../_core/authn/require-api-key';
import { AccountsService } from '../ledger/accounts/accounts.service';
import { toExternalAccount } from './external.dto';
import { ExternalLookupService } from './external-lookup.service';

const routes = externalContract.accounts;

@Controller()
export class ExternalAccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly lookup: ExternalLookupService,
  ) {}

  @ApiKeyAuth(routes.list)
  @TsRestHandler(routes.list)
  list(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.list, async ({ query }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      const accounts = await this.accounts.list(userId, groupId, query.includeArchived ?? false);
      const currencies = await this.lookup.currencyCodes();
      return { status: 200 as const, body: accounts.map((account) => toExternalAccount(account, currencies)) };
    });
  }

  @ApiKeyAuth(routes.get)
  @TsRestHandler(routes.get)
  get(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.get, async ({ params }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      const account = await this.accounts.get(userId, groupId, params.accountId);
      return { status: 200 as const, body: toExternalAccount(account, await this.lookup.currencyCodes()) };
    });
  }

  @ApiKeyAuth(routes.create)
  @TsRestHandler(routes.create)
  create(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.create, async ({ body }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      const { currency, ...fields } = body;
      const created = await this.accounts.create(userId, groupId, {
        ...fields,
        currencyId: await this.lookup.currencyIdOf(currency),
      });
      return { status: 201 as const, body: toExternalAccount(created, await this.lookup.currencyCodes()) };
    });
  }

  @ApiKeyAuth(routes.update)
  @TsRestHandler(routes.update)
  update(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.update, async ({ params, body }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      const updated = await this.accounts.update(userId, groupId, params.accountId, body);
      return { status: 200 as const, body: toExternalAccount(updated, await this.lookup.currencyCodes()) };
    });
  }
}
