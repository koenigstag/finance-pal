import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, Category, Profile, User } from '@ft/api-database';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, User, Account, Category])],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  // seedGroup() is called from GroupsService, which authorizes the caller against the group
  // first — onboarding itself has no notion of group membership.
  exports: [OnboardingService],
})
export class OnboardingModule {}
