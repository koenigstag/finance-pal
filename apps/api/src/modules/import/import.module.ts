import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, Category, Currency, Group, GroupMember, RecurringRule, Transaction } from '@ft/api-database';
import { AccountsModule } from '../ledger/accounts/accounts.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [TypeOrmModule.forFeature([Group, GroupMember, Currency, Account, Category, Transaction, RecurringRule]), AccountsModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
