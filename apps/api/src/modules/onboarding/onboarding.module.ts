import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, Category, Profile } from '@ft/api-database';
import { GroupsModule } from '../groups/groups.module';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [TypeOrmModule.forFeature([Profile, Account, Category]), GroupsModule],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
