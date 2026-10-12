import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';
import { ExchangeRatesModule } from './exchange-rates/exchange-rates.module';
import { AccountsModule } from './accounts/accounts.module';
import { BudgetsModule } from './budgets/budgets.module';
import { CategoriesModule } from './categories/categories.module';
import { CategoryRulesModule } from './category-rules/category-rules.module';
import { OverviewModule } from './overview/overview.module';
import { TagsModule } from './tags/tags.module';
import { TransactionsModule } from './transactions/transactions.module';

@Module({
  imports: [
    CurrenciesModule,
    ExchangeRatesModule,
    AccountsModule,
    CategoriesModule,
    CategoryRulesModule,
    TagsModule,
    TransactionsModule,
    BudgetsModule,
    OverviewModule,
  ],
})
export class LedgerModule {}
