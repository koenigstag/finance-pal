import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, Category, Tag, Transaction, TransactionTag } from '@ft/api-database';
import { AuthzModule } from '../../_core/authz/authz.module';
import { RealtimeModule } from '../../realtime/realtime.module';
import { TransactionValidator } from './transaction-validator';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction, TransactionTag, Account, Category, Tag]), AuthzModule, RealtimeModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, TransactionValidator],
  exports: [TransactionValidator],
})
export class TransactionsModule {}
