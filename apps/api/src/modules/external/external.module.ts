import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account, ApiKey, Category, CategoryRule, ChangeSet, Currency, Group, Profile, RecurringRule, Transaction } from '@ft/api-database';
import { externalContract } from '@ft/shared-contracts';
import { AuthzModule } from '../_core/authz/authz.module';
import { AccountsModule } from '../ledger/accounts/accounts.module';
import { BudgetsModule } from '../ledger/budgets/budgets.module';
import { CategoriesModule } from '../ledger/categories/categories.module';
import { ExchangeRatesModule } from '../ledger/exchange-rates/exchange-rates.module';
import { OverviewModule } from '../ledger/overview/overview.module';
import { TransactionsModule } from '../ledger/transactions/transactions.module';
import { OauthModule } from '../oauth/oauth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RecurringModule } from '../recurring/recurring.module';
import { ChangeSetsService } from './changes/change-sets.service';
import { ExternalAccountsController } from './external-accounts.controller';
import { ExternalCategoriesController } from './external-categories.controller';
import { ExternalKeyController } from './external-key.controller';
import { ExternalLookupService } from './external-lookup.service';
import { ExternalTransactionsController } from './external-transactions.controller';
import { ExternalTransactionsService } from './external-transactions.service';
import { FinanceMcpService } from './mcp/finance-mcp.service';
import { McpChangeTools } from './mcp/mcp-change-tools';
import { McpSeriesTools } from './mcp/mcp-series-tools';
import { McpWriteTools } from './mcp/mcp-write-tools';
import { McpController } from './mcp/mcp.controller';
import { McpUnauthorizedFilter } from './mcp/mcp-unauthorized.filter';
import { ExternalNotificationsController } from './notifications/external-notifications.controller';
import { ExternalNotificationsService } from './notifications/external-notifications.service';
import { PlainTextNotificationMiddleware } from './notifications/plain-text-notification.middleware';

/**
 * The external API (/api/external/v1): what other apps reach with an API key. It holds no ledger
 * logic of its own — it translates requests for the same services the web app goes through, so
 * permissions, validation, balances and realtime updates can't differ between the two. The MCP
 * endpoint (/api/mcp), where AI assistants read and change a group, is part of it on the same terms.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey, Group, Account, Category, CategoryRule, ChangeSet, Currency, Profile, RecurringRule, Transaction]),
    AuthzModule,
    AccountsModule,
    BudgetsModule,
    CategoriesModule,
    ExchangeRatesModule,
    OverviewModule,
    TransactionsModule,
    RecurringModule,
    OauthModule,
    RealtimeModule,
  ],
  controllers: [
    ExternalKeyController,
    ExternalAccountsController,
    ExternalCategoriesController,
    ExternalTransactionsController,
    ExternalNotificationsController,
    McpController,
  ],
  providers: [
    ExternalLookupService,
    ExternalTransactionsService,
    ExternalNotificationsService,
    FinanceMcpService,
    ChangeSetsService,
    McpChangeTools,
    McpWriteTools,
    McpSeriesTools,
    McpUnauthorizedFilter,
  ],
})
export class ExternalModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(PlainTextNotificationMiddleware)
      .forRoutes({ path: externalContract.notifications.forward.path.replace(/^\//, ''), method: RequestMethod.POST });
  }
}
