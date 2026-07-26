import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group, GroupMember, User } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { MembersService } from './members.service';

@Module({
  imports: [TypeOrmModule.forFeature([Group, GroupMember, User]), AuthzModule],
  controllers: [GroupsController],
  providers: [GroupsService, MembersService],
  // GroupsService is reused by OnboardingModule to create a new user's default group —
  // same RLS-pinned insert path, no reason to duplicate it.
  exports: [GroupsService],
})
export class GroupsModule {}
