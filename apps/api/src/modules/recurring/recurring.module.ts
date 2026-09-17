import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecurringRule, Transaction } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TransactionsModule } from '../ledger/transactions/transactions.module';
import { RecurringRulesController } from './recurring-rules.controller';
import { RecurringRulesService } from './recurring-rules.service';

@Module({
  imports: [TypeOrmModule.forFeature([RecurringRule, Transaction]), AuthzModule, RealtimeModule, TransactionsModule],
  controllers: [RecurringRulesController],
  providers: [RecurringRulesService],
})
export class RecurringModule {}
