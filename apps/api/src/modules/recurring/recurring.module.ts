import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, RecurringRule, Transaction } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TransactionsModule } from '../ledger/transactions/transactions.module';
import { RecurringProcessorService } from './recurring-processor.service';
import { RecurringRulesController } from './recurring-rules.controller';
import { RecurringRulesService } from './recurring-rules.service';

@Module({
  imports: [
    // The scheduler is this module's alone; registered here rather than in AppModule so the
    // cron dependency lives next to its only user.
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([RecurringRule, Transaction, Account]),
    AuthzModule,
    RealtimeModule,
    TransactionsModule,
  ],
  controllers: [RecurringRulesController],
  providers: [RecurringRulesService, RecurringProcessorService],
})
export class RecurringModule {}
