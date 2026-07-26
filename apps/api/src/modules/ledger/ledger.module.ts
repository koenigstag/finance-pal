import { Module } from '@nestjs/common';
import { CurrenciesModule } from './currencies/currencies.module';

@Module({
  imports: [CurrenciesModule],
})
export class LedgerModule {}
