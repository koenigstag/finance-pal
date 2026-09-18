import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, ApiKey, Category, Currency, Group } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { AccountsModule } from '../ledger/accounts/accounts.module';
import { CategoriesModule } from '../ledger/categories/categories.module';
import { TransactionsModule } from '../ledger/transactions/transactions.module';
import { ExternalAccountsController } from './external-accounts.controller';
import { ExternalCategoriesController } from './external-categories.controller';
import { ExternalKeyController } from './external-key.controller';
import { ExternalLookupService } from './external-lookup.service';
import { ExternalTransactionsController } from './external-transactions.controller';
import { ExternalTransactionsService } from './external-transactions.service';

/**
 * The external API (/api/external/v1): what other apps reach with an API key. It holds no ledger
 * logic of its own — it translates requests for the same services the web app goes through, so
 * permissions, validation, balances and realtime updates can't differ between the two.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey, Group, Account, Category, Currency]),
    AuthzModule,
    AccountsModule,
    CategoriesModule,
    TransactionsModule,
  ],
  controllers: [ExternalKeyController, ExternalAccountsController, ExternalCategoriesController, ExternalTransactionsController],
  providers: [ExternalLookupService, ExternalTransactionsService],
})
export class ExternalModule {}
