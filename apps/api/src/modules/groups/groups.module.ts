import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Group, GroupMember } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([Group, GroupMember]), AuthzModule],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
