import { Module } from '@nestjs/common';
import { RATE_PROVIDERS, type RateProvider } from './rate-provider';
import { CurrencyApiProvider } from './providers/currency-api.provider';
import { OpenErApiProvider } from './providers/open-er-api.provider';

@Module({
  providers: [
    CurrencyApiProvider,
    OpenErApiProvider,
    {
      provide: RATE_PROVIDERS,
      // Fallback order rather than a ranking by quality: currency-api covers several times more
      // codes and costs nothing to attribute, so open.er-api answers only when it is unreachable.
      useFactory: (currencyApi: CurrencyApiProvider, openErApi: OpenErApiProvider): RateProvider[] => [
        currencyApi,
        openErApi,
      ],
      inject: [CurrencyApiProvider, OpenErApiProvider],
    },
  ],
  exports: [RATE_PROVIDERS, CurrencyApiProvider, OpenErApiProvider],
})
export class ExchangeRatesModule {}
