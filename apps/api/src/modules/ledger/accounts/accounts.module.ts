import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, AccountTarget } from '@ft/api-database';
import { AuthzModule } from '../../_core/authz/authz.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, AccountTarget]), AuthzModule],
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
