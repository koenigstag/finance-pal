import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Account,
  AccountTarget,
  Category,
  Currency,
  Group,
  GroupMember,
  RecurringRule,
  Tag,
  Transaction,
  TransactionTag,
} from '@ft/api-database';
import { AccountsModule } from '../ledger/accounts/accounts.module';
import { ExchangeRatesModule } from '../ledger/exchange-rates/exchange-rates.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Group,
      GroupMember,
      Currency,
      Account,
      AccountTarget,
      Category,
      Tag,
      Transaction,
      TransactionTag,
      RecurringRule,
    ]),
    AccountsModule,
    ExchangeRatesModule,
  ],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
