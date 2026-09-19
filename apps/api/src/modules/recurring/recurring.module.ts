import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, RecurringRule, Transaction } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { PushModule } from '../push/push.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TransactionsModule } from '../ledger/transactions/transactions.module';
import { RecurringProcessorService } from './recurring-processor.service';
import { RecurringRulesController } from './recurring-rules.controller';
import { RecurringRulesService } from './recurring-rules.service';

@Module({
  imports: [
    // @Cron comes from CoreModule's single ScheduleModule.forRoot(); this module only declares jobs.
    TypeOrmModule.forFeature([RecurringRule, Transaction, Account]),
    AuthzModule,
    PushModule,
    RealtimeModule,
    TransactionsModule,
  ],
  controllers: [RecurringRulesController],
  providers: [RecurringRulesService, RecurringProcessorService],
})
export class RecurringModule {}
