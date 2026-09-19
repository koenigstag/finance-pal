import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import {
  DEFAULT_RATE_TIMEOUT_MS,
  RATE_REQUEST_TIMEOUT_MS,
  RateProviderError,
  normalizeCode,
  toRateMap,
  type RateProvider,
  type RateSnapshot,
} from '../rate-provider';
import { fetchJson } from './fetch-json';

// @fawazahmed0/currency-api, public domain (CC0), no key and no quota. It quotes any base
// directly, so nothing here has to triangulate through a pivot currency and inherit its rounding.
// The same files are served from npm via jsDelivr and from the project's own Pages deployment;
// the README asks consumers to fall back to the second host, because the CDN copy does go missing.
const HOSTS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1',
  'https://latest.currency-api.pages.dev/v1',
];

// { "date": "2026-09-17", "eur": { "pln": 4.36324096, ... } } — the rate map hangs off the
// lowercase base code, so it can only be picked out once we know which base was asked for.
const bodySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).passthrough();
const ratesSchema = z.record(z.unknown());

@Injectable()
export class CurrencyApiProvider implements RateProvider {
  readonly name = 'currency-api';

  constructor(
    @Optional()
    @Inject(RATE_REQUEST_TIMEOUT_MS)
    private readonly timeoutMs: number = DEFAULT_RATE_TIMEOUT_MS,
  ) {}

  async getRates(base: string): Promise<RateSnapshot> {
    const code = normalizeCode(base);
    const path = `/currencies/${code.toLowerCase()}.json`;
    const failures: string[] = [];

    for (const host of HOSTS) {
      try {
        return this.toSnapshot(await fetchJson(this.name, `${host}${path}`, this.timeoutMs), code);
      } catch (error) {
        if (!(error instanceof RateProviderError)) {
          throw error;
        }
        failures.push(error.message);
      }
    }

    throw new RateProviderError(this.name, `no host served ${code} (${failures.join('; ')})`);
  }

  private toSnapshot(body: unknown, base: string): RateSnapshot {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw new RateProviderError(this.name, 'response carries no publication date');
    }

    const raw = ratesSchema.safeParse(parsed.data[base.toLowerCase()]);
    if (!raw.success) {
      throw new RateProviderError(this.name, `response carries no rates for ${base}`);
    }

    const rates = toRateMap(raw.data);
    if (Object.keys(rates).length === 0) {
      throw new RateProviderError(this.name, `response has an empty rate map for ${base}`);
    }

    return { base, date: parsed.data.date, rates, provider: this.name };
  }
}
