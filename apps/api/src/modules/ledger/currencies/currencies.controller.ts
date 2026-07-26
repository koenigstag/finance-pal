import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { currenciesContract } from '@ft/shared-contracts';
import { Currency } from '@ft/api-database';
import { CurrenciesService } from './currencies.service';

function toCurrencyDto(currency: Currency) {
  return {
    id: currency.id,
    code: currency.code,
    name: currency.name,
    symbol: currency.symbol,
  };
}

@Controller()
export class CurrenciesController {
  constructor(private readonly currencies: CurrenciesService) {}

  @TsRestHandler(currenciesContract.list)
  list() {
    return tsRestHandler(currenciesContract.list, async () => {
      const currencies = await this.currencies.list();
      return { status: 200 as const, body: currencies.map(toCurrencyDto) };
    });
  }
}
