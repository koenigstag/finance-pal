import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { authContract } from '@ft/shared-contracts';
import type { User } from '@ft/api-database';
import { Public } from '../_core/authn/public.decorator';
import { AuthService } from './auth.service';

function toUserDto(user: User) {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}

// Every route here runs before an identity exists, so none of them can require a token.
// This is also why users/refresh_tokens carry no RLS policies — there would be no
// app.current_user_id to filter on.
@Public()
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @TsRestHandler(authContract.register)
  register() {
    return tsRestHandler(authContract.register, async ({ body }) => {
      const result = await this.auth.register(body.email, body.password);
      return {
        status: 201 as const,
        body: { user: toUserDto(result.user), accessToken: result.accessToken, refreshToken: result.refreshToken },
      };
    });
  }

  @TsRestHandler(authContract.login)
  login() {
    return tsRestHandler(authContract.login, async ({ body }) => {
      const result = await this.auth.login(body.email, body.password);
      return {
        status: 200 as const,
        body: { user: toUserDto(result.user), accessToken: result.accessToken, refreshToken: result.refreshToken },
      };
    });
  }

  @TsRestHandler(authContract.refresh)
  refresh() {
    return tsRestHandler(authContract.refresh, async ({ body }) => {
      const result = await this.auth.refresh(body.refreshToken);
      return { status: 200 as const, body: result };
    });
  }

  @TsRestHandler(authContract.logout)
  logout() {
    return tsRestHandler(authContract.logout, async ({ body }) => {
      await this.auth.logout(body.refreshToken);
      return { status: 204 as const, body: undefined };
    });
  }
}
