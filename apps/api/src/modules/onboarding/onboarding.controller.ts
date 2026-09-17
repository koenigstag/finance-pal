import { Controller, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { onboardingContract } from '@ft/shared-contracts';
import type { Profile } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../_core/authn/request-user';
import { OnboardingService } from './onboarding.service';

function toProfileDto(profile: Profile) {
  return {
    displayName: profile.displayName,
    startDayOfWeek: profile.startDayOfWeek,
    mainCurrencyId: profile.mainCurrencyId,
    language: profile.language,
  };
}

@Controller()
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @TsRestHandler(onboardingContract.status)
  status(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(onboardingContract.status, async () => {
      const status = await this.onboarding.getStatus(requireUser(user).id);
      return { status: 200 as const, body: status };
    });
  }

  @TsRestHandler(onboardingContract.getProfile)
  getProfile(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(onboardingContract.getProfile, async () => {
      const profile = await this.onboarding.getProfile(requireUser(user).id);
      if (!profile) {
        throw new NotFoundException('Profile not found');
      }
      return { status: 200 as const, body: toProfileDto(profile) };
    });
  }

  @TsRestHandler(onboardingContract.updateProfile)
  updateProfile(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(onboardingContract.updateProfile, async ({ body }) => {
      const profile = await this.onboarding.upsertProfile(requireUser(user).id, body);
      return { status: 200 as const, body: toProfileDto(profile) };
    });
  }
}

function requireUser(user: RequestUser | undefined): RequestUser {
  if (!user) {
    throw new UnauthorizedException('Missing authenticated user');
  }
  return user;
}
