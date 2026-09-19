import { Controller, UnauthorizedException } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { exchangeRatesContract } from '@ft/shared-contracts';
import { CurrentUser, type RequestUser } from '../../_core/authn/request-user';
import { ExchangeRatesService } from './exchange-rates.service';

@Controller()
export class ExchangeRatesController {
  constructor(private readonly rates: ExchangeRatesService) {}

  @TsRestHandler(exchangeRatesContract.get)
  get(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(exchangeRatesContract.get, async () => {
      const base = await this.rates.baseCodeFor(requireUser(user).id);
      const snapshot = await this.rates.getRates(base);

      return {
        status: 200 as const,
        body: {
          base: snapshot.baseCode,
          rates: snapshot.rates,
          publishedOn: snapshot.publishedOn,
          provider: snapshot.provider,
          attribution: this.rates.attributionFor(snapshot.provider),
        },
      };
    });
  }
}

function requireUser(user: RequestUser | undefined): RequestUser {
  if (!user) {
    throw new UnauthorizedException('Missing authenticated user');
  }
  return user;
}
