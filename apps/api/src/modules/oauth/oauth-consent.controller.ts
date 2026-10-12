import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { oauthContract } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { OauthService } from './oauth.service';

// The web app's consent page, signed in: what an app asking to connect would get, and the yes.
@Controller()
export class OauthConsentController {
  constructor(private readonly oauth: OauthService) {}

  @TsRestHandler(oauthContract.describe)
  describe() {
    return tsRestHandler(oauthContract.describe, async ({ query }) => ({
      status: 200 as const,
      body: this.oauth.describe(query),
    }));
  }

  @TsRestHandler(oauthContract.approve)
  approve(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(oauthContract.approve, async ({ body }) => ({
      status: 200 as const,
      body: { redirectTo: await this.oauth.approve(requireUser(user).id, body) },
    }));
  }
}
