import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group, GroupMember, User } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { MembersService } from './members.service';

@Module({
  imports: [TypeOrmModule.forFeature([Group, GroupMember, User]), AuthzModule, OnboardingModule],
  controllers: [GroupsController],
  providers: [GroupsService, MembersService],
})
export class GroupsModule {}
