import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';
import { AccountsModule } from './accounts/accounts.module';
import { CategoriesModule } from './categories/categories.module';
import { TagsModule } from './tags/tags.module';

@Module({
  imports: [CurrenciesModule, AccountsModule, CategoriesModule, TagsModule],
})
export class LedgerModule {}
