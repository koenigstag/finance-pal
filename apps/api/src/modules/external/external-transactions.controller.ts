import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { externalContract } from '@ft/shared-contracts';
import { ApiKeyAuth } from '../_core/authn/api-key-auth.decorator';
import { CurrentApiKey, type RequestApiKey } from '../_core/authn/request-user';
import { requireApiKey } from '../_core/authn/require-api-key';
import { TransactionsService } from '../ledger/transactions/transactions.service';
import { toExternalTransaction } from './external.dto';
import { ExternalLookupService } from './external-lookup.service';
import { ExternalTransactionsService } from './external-transactions.service';

const routes = externalContract.transactions;

@Controller()
export class ExternalTransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly external: ExternalTransactionsService,
    private readonly lookup: ExternalLookupService,
  ) {}

  @ApiKeyAuth(routes.list)
  @TsRestHandler(routes.list)
  list(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.list, async ({ query }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      const page = await this.transactions.list(userId, groupId, query);
      const currencies = await this.lookup.currencyCodes();
      return {
        status: 200 as const,
        body: { items: page.items.map((t) => toExternalTransaction(t, currencies)), nextCursor: page.nextCursor },
      };
    });
  }

  @ApiKeyAuth(routes.get)
  @TsRestHandler(routes.get)
  get(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.get, async ({ params }) => {
      const { userId, groupId } = requireApiKey(apiKey);
      const { transaction } = await this.transactions.get(userId, groupId, params.transactionId);
      return { status: 200 as const, body: toExternalTransaction(transaction, await this.lookup.currencyCodes()) };
    });
  }

  @ApiKeyAuth(routes.create)
  @TsRestHandler(routes.create)
  create(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.create, async ({ body }) => {
      const transaction = await this.external.create(requireApiKey(apiKey), body);
      return { status: 201 as const, body: toExternalTransaction(transaction, await this.lookup.currencyCodes()) };
    });
  }

  @ApiKeyAuth(routes.update)
  @TsRestHandler(routes.update)
  update(@CurrentApiKey() apiKey?: RequestApiKey) {
    return tsRestHandler(routes.update, async ({ params, body }) => {
      const transaction = await this.external.update(requireApiKey(apiKey), params.transactionId, body);
      return { status: 200 as const, body: toExternalTransaction(transaction, await this.lookup.currencyCodes()) };
    });
  }
}
