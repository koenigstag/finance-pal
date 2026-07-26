import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';
import { AccountsModule } from './accounts/accounts.module';

@Module({
  imports: [CurrenciesModule, AccountsModule],
})
export class LedgerModule {}
