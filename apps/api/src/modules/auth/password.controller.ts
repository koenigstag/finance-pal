import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { authContract } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { requireUser } from '../_core/authn/require-user';
import { AuthService } from './auth.service';

// Separate from AuthController because that one is @Public(): its routes all run before an
// identity exists. Changing a password is the opposite — it needs the caller to already be
// signed in, so it lives in a controller the global JwtAuthGuard still applies to.
@Controller()
export class PasswordController {
  constructor(private readonly auth: AuthService) {}

  @TsRestHandler(authContract.changePassword)
  changePassword(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(authContract.changePassword, async ({ body }) => {
      const tokens = await this.auth.changePassword(requireUser(user).id, body.currentPassword, body.newPassword);
      return { status: 200 as const, body: tokens };
    });
  }
}
