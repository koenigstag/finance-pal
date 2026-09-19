import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Currency, RecurringRule, Transaction } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { PushModule } from '../push/push.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ExchangeRatesModule } from '../ledger/exchange-rates/exchange-rates.module';
import { TransactionsModule } from '../ledger/transactions/transactions.module';
import { RecurringProcessorService } from './recurring-processor.service';
import { RecurringRulesController } from './recurring-rules.controller';
import { RecurringRulesService } from './recurring-rules.service';

@Module({
  imports: [
    // @Cron comes from CoreModule's single ScheduleModule.forRoot(); this module only declares jobs.
    TypeOrmModule.forFeature([RecurringRule, Transaction, Currency]),
    AuthzModule,
    PushModule,
    RealtimeModule,
    TransactionsModule,
    ExchangeRatesModule,
  ],
  controllers: [RecurringRulesController],
  providers: [RecurringRulesService, RecurringProcessorService],
})
export class RecurringModule {}
