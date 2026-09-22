import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountTarget, Category, Currency, RecurringRule, Tag, Transaction, TransactionTag } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { AccountsModule } from '../ledger/accounts/accounts.module';
import { ExportController } from './export.controller';
import { ExportService } from './export.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Currency, AccountTarget, Category, Tag, Transaction, TransactionTag, RecurringRule]),
    AuthzModule,
    AccountsModule,
  ],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
