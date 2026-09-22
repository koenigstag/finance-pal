import { Controller, Res } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import type { Response } from 'express';
import { externalContract } from '@ft/shared-contracts';
import { ApiKeyAuth } from '../../_core/authn/api-key-auth.decorator';
import { CurrentApiKey, type RequestApiKey } from '../../_core/authn/request-user';
import { requireApiKey } from '../../_core/authn/require-api-key';
import { toExternalTransaction } from '../external.dto';
import { ExternalLookupService } from '../external-lookup.service';
import { ExternalNotificationsService } from './external-notifications.service';

const routes = externalContract.notifications;

@Controller()
export class ExternalNotificationsController {
  constructor(
    private readonly notifications: ExternalNotificationsService,
    private readonly lookup: ExternalLookupService,
  ) {}

  @ApiKeyAuth(routes.forward)
  @TsRestHandler(routes.forward)
  // passthrough: the header below is set here, the body is still sent by ts-rest.
  forward(@CurrentApiKey() apiKey?: RequestApiKey, @Res({ passthrough: true }) response?: Response) {
    return tsRestHandler(routes.forward, async ({ body }) => {
      const result = await this.notifications.forward(requireApiKey(apiKey), body);
      if (!result.recorded) {
        return { status: 200 as const, body: { recorded: false as const, reason: result.reason } };
      }
      if (result.replayed) {
        response?.setHeader('Idempotent-Replayed', 'true');
      }
      return { status: 201 as const, body: toExternalTransaction(result.transaction, await this.lookup.currencyCodes()) };
    });
  }
}
