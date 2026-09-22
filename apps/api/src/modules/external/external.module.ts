import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, ApiKey, Category, CategoryRule, Currency, Group, Transaction } from '@ft/api-database';
import { externalContract } from '@ft/shared-contracts';
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
import { ExternalNotificationsController } from './notifications/external-notifications.controller';
import { ExternalNotificationsService } from './notifications/external-notifications.service';
import { PlainTextNotificationMiddleware } from './notifications/plain-text-notification.middleware';

/**
 * The external API (/api/external/v1): what other apps reach with an API key. It holds no ledger
 * logic of its own — it translates requests for the same services the web app goes through, so
 * permissions, validation, balances and realtime updates can't differ between the two.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey, Group, Account, Category, CategoryRule, Currency, Transaction]),
    AuthzModule,
    AccountsModule,
    CategoriesModule,
    TransactionsModule,
  ],
  controllers: [
    ExternalKeyController,
    ExternalAccountsController,
    ExternalCategoriesController,
    ExternalTransactionsController,
    ExternalNotificationsController,
  ],
  providers: [ExternalLookupService, ExternalTransactionsService, ExternalNotificationsService],
})
export class ExternalModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PlainTextNotificationMiddleware)
      .forRoutes({ path: externalContract.notifications.forward.path.replace(/^\//, ''), method: RequestMethod.POST });
  }
}
