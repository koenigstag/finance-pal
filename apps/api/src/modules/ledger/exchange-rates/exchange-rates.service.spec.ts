import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { Currency, ExchangeRate, Profile } from '@ft/api-database';
import { ExchangeRatesService } from './exchange-rates.service';
import { RateProviderError, type RateProvider, type RateSnapshot } from './rate-provider';

const HOUR = 60 * 60 * 1000;

function snapshotOf(provider: string, rates: Record<string, number> = { USD: 0.025 }): RateSnapshot {
  return { base: 'UAH', date: '2026-09-18', rates, provider };
}

function providerThat(name: string, answer: RateSnapshot | Error): RateProvider {
  return {
    name,
    getRates: jest.fn(async () => {
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    }),
  };
}

function stored(overrides: Partial<ExchangeRate> = {}): ExchangeRate {
  return {
    baseCode: 'UAH',
    rates: { UAH: '1', USD: '41' },
    publishedOn: '2026-09-01',
    provider: 'currency-api',
    fetchedAt: new Date(Date.now() - 48 * HOUR),
    ...overrides,
  } as ExchangeRate;
}

interface Fakes {
  cache: { row: ExchangeRate | null; upsert: jest.Mock };
  service: ExchangeRatesService;
}

function makeService(providers: RateProvider[], row: ExchangeRate | null): Fakes {
  const cache = {
    row,
    upsert: jest.fn(async () => undefined),
  };
  const cacheRepo = {
    findOneBy: async () => cache.row,
    create: (input: Partial<ExchangeRate>) => input as ExchangeRate,
    upsert: cache.upsert,
  } as unknown as Repository<ExchangeRate>;
  const currencyRepo = {
    find: async () => [{ code: 'UAH' }, { code: 'USD' }] as Currency[],
    findOneBy: async () => ({ id: 1, code: 'UAH' }) as Currency,
  } as unknown as Repository<Currency>;
  const profileRepo = {
    findOneBy: async () => ({ id: 'user-1', mainCurrencyId: 1 }) as Profile,
  } as unknown as Repository<Profile>;

  return { cache, service: new ExchangeRatesService(providers, cacheRepo, currencyRepo, profileRepo) };
}

describe('ExchangeRatesService', () => {
  it('serves what is cached without asking a provider', async () => {
    const provider = providerThat('currency-api', snapshotOf('currency-api'));
    const { service } = makeService([provider], stored({ fetchedAt: new Date(Date.now() - HOUR) }));

    await expect(service.getRates('UAH')).resolves.toMatchObject({ publishedOn: '2026-09-01' });
    expect(provider.getRates).not.toHaveBeenCalled();
  });

  it('refreshes once the cached rates have gone stale', async () => {
    const provider = providerThat('currency-api', snapshotOf('currency-api'));
    const { service, cache } = makeService([provider], stored());

    await expect(service.getRates('UAH')).resolves.toMatchObject({
      publishedOn: '2026-09-18',
      provider: 'currency-api',
      rates: { UAH: '1', USD: '40' },
    });
    expect(cache.upsert).toHaveBeenCalled();
  });

  it('falls through to the next provider when the first cannot answer', async () => {
    const first = providerThat('currency-api', new RateProviderError('currency-api', 'no host served UAH'));
    const second = providerThat('open-er-api', snapshotOf('open-er-api'));
    const { service } = makeService([first, second], null);

    await expect(service.getRates('UAH')).resolves.toMatchObject({ provider: 'open-er-api' });
    expect(second.getRates).toHaveBeenCalled();
  });

  it('keeps serving stale rates when no provider answers', async () => {
    const down = providerThat('currency-api', new RateProviderError('currency-api', 'unreachable'));
    const { service, cache } = makeService([down], stored());

    await expect(service.getRates('UAH')).resolves.toMatchObject({ publishedOn: '2026-09-01' });
    expect(cache.upsert).not.toHaveBeenCalled();
  });

  it('fails only when nothing was ever cached to fall back on', async () => {
    const down = providerThat('currency-api', new RateProviderError('currency-api', 'unreachable'));
    const { service } = makeService([down], null);

    await expect(service.getRates('UAH')).rejects.toThrow(ServiceUnavailableException);
  });

  it('refuses to cache a snapshot that covers none of our currencies', async () => {
    const useless = providerThat('currency-api', snapshotOf('currency-api', { DOGE: 3 }));
    const { service, cache } = makeService([useless], null);

    await expect(service.getRates('UAH')).rejects.toThrow(ServiceUnavailableException);
    expect(cache.upsert).not.toHaveBeenCalled();
  });

  it('carries the credit for whichever provider quoted the cached rates', () => {
    const plain = providerThat('currency-api', snapshotOf('currency-api'));
    const credited: RateProvider = {
      ...providerThat('open-er-api', snapshotOf('open-er-api')),
      attribution: { text: 'Rates By Exchange Rate API', url: 'https://www.exchangerate-api.com' },
    };
    const { service } = makeService([plain, credited], null);

    expect(service.attributionFor('open-er-api')).toEqual(credited.attribution);
    expect(service.attributionFor('currency-api')).toBeNull();
  });

  it('quotes against the main currency on the caller profile', async () => {
    const { service } = makeService([providerThat('currency-api', snapshotOf('currency-api'))], null);

    await expect(service.baseCodeFor('user-1')).resolves.toBe('UAH');
  });

  it('has no base to quote against without a profile', async () => {
    const { service } = makeService([], null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).profiles = { findOneBy: async () => null };

    await expect(service.baseCodeFor('nobody')).rejects.toThrow(NotFoundException);
  });
});
