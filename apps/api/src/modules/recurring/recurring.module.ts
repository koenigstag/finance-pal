import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Currency, RecurringRule, Transaction } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ExchangeRatesModule } from '../ledger/exchange-rates/exchange-rates.module';
import { TransactionsModule } from '../ledger/transactions/transactions.module';
import { RecurringProcessorService } from './recurring-processor.service';
import { RecurringRulesController } from './recurring-rules.controller';
import { RecurringRulesService } from './recurring-rules.service';

@Module({
  imports: [
    // The scheduler is this module's alone; registered here rather than in AppModule so the
    // cron dependency lives next to its only user.
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([RecurringRule, Transaction, Currency]),
    AuthzModule,
    RealtimeModule,
    TransactionsModule,
    ExchangeRatesModule,
  ],
  controllers: [RecurringRulesController],
  providers: [RecurringRulesService, RecurringProcessorService],
})
export class RecurringModule {}
