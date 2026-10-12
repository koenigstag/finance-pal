import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { overviewContract } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../../_core/authn/request-user';
import { requireUser } from '../../_core/authn/require-user';
import { OverviewService } from './overview.service';

@Controller()
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @TsRestHandler(overviewContract.days)
  days(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(overviewContract.days, async ({ params, query }) => {
      const days = await this.overview.days(requireUser(user).id, params.groupId, query);
      return { status: 200 as const, body: { days } };
    });
  }
}
