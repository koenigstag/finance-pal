import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';
import { AccountsModule } from './accounts/accounts.module';
import { CategoriesModule } from './categories/categories.module';

@Module({
  imports: [CurrenciesModule, AccountsModule, CategoriesModule],
})
export class LedgerModule {}
