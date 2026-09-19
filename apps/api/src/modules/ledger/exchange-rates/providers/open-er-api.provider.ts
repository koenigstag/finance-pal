import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import {
  DEFAULT_RATE_TIMEOUT_MS,
  RATE_REQUEST_TIMEOUT_MS,
  RateProviderError,
  normalizeCode,
  toRateMap,
  type RateAttribution,
  type RateProvider,
  type RateSnapshot,
} from '../rate-provider';
import { fetchJson } from './fetch-json';

// ExchangeRate-API's open access tier: no key, any base, 160-odd currencies, refreshed once a day.
const ENDPOINT = 'https://open.er-api.com/v6/latest';

// A refused request still answers 200 with result: "error", so the body decides success here, not
// the status code. `rates` arrives keyed by uppercase code and includes the base itself at 1.
const bodySchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('success'),
    time_last_update_unix: z.number().int().positive(),
    rates: z.record(z.unknown()),
  }),
  z.object({
    result: z.literal('error'),
    'error-type': z.string().optional(),
  }),
]);

@Injectable()
export class OpenErApiProvider implements RateProvider {
  readonly name = 'open-er-api';

  // Required by the open access terms: the credit has to be visible wherever these rates are
  // shown. Styling is ours to choose, the link is not optional.
  readonly attribution: RateAttribution = {
    text: 'Rates By Exchange Rate API',
    url: 'https://www.exchangerate-api.com',
  };

  constructor(
    @Optional()
    @Inject(RATE_REQUEST_TIMEOUT_MS)
    private readonly timeoutMs: number = DEFAULT_RATE_TIMEOUT_MS,
  ) {}

  async getRates(base: string): Promise<RateSnapshot> {
    const code = normalizeCode(base);
    const body = await fetchJson(this.name, `${ENDPOINT}/${code}`, this.timeoutMs);

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw new RateProviderError(this.name, `response for ${code} is not in the documented shape`);
    }
    if (parsed.data.result === 'error') {
      throw new RateProviderError(this.name, `refused ${code}: ${parsed.data['error-type'] ?? 'unknown reason'}`);
    }

    const rates = toRateMap(parsed.data.rates);
    if (Object.keys(rates).length === 0) {
      throw new RateProviderError(this.name, `response has an empty rate map for ${code}`);
    }

    return {
      base: code,
      // The provider dates a snapshot by when it last refreshed, so derive the publication day
      // from that rather than from our own clock, which can already be on the next UTC day.
      date: new Date(parsed.data.time_last_update_unix * 1000).toISOString().slice(0, 10),
      rates,
      provider: this.name,
    };
  }
}
