import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group, GroupMember } from '@ft/api-database';
import { AbilityFactory } from './ability.factory';

// Authorization (what the caller may do), as opposed to authentication in AuthnModule.
// This is only the permission layer — row visibility is enforced by Postgres RLS.
@Module({
  imports: [TypeOrmModule.forFeature([Group, GroupMember])],
  providers: [AbilityFactory],
  exports: [AbilityFactory],
})
export class AuthzModule {}
