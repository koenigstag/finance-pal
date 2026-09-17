import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, AccountTarget, RecurringRule, Transaction } from '@ft/api-database';
import { AuthzModule } from '../../_core/authz/authz.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Account, AccountTarget, Transaction, RecurringRule]), AuthzModule, RealtimeModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
