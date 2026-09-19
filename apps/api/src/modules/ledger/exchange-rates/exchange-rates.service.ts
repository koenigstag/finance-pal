import { Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency, ExchangeRate, Profile } from '@ft/api-database';
import {
  RATE_PROVIDERS,
  normalizeCode,
  type RateAttribution,
  type RateProvider,
  type RateSnapshot,
} from './rate-provider';
import { toBaseRates } from './rate-math';

// Providers publish once a day, so refreshing twice as often picks up a new day within half of
// one without ever approaching the rate limits the free tiers ask us to respect.
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * What one unit of `from` costs in `to`, as a decimal string, or null when no rate is to be had
 * for the pair (see ExchangeRatesService.rateBetween). A function rather than the service, so the
 * code that converts — the recurring engine, run by requests and the scheduler alike — can be
 * handed one without depending on Nest.
 */
export type RateLookup = (from: string, to: string) => Promise<string | null>;

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);

  constructor(
    @Inject(RATE_PROVIDERS) private readonly providers: readonly RateProvider[],
    @InjectRepository(ExchangeRate) private readonly cache: Repository<ExchangeRate>,
    @InjectRepository(Currency) private readonly currencies: Repository<Currency>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
  ) {}

  /** The code every rate shown to this user is quoted against: their main currency. */
  async baseCodeFor(userId: string): Promise<string> {
    const profile = await this.profiles.findOneBy({ id: userId });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    const currency = await this.currencies.findOneBy({ id: profile.mainCurrencyId });
    if (!currency) {
      throw new NotFoundException('Main currency not found');
    }
    return currency.code;
  }

  /**
   * The cached rates for `baseCode`, refreshed when they have gone stale.
   *
   * A refresh that fails falls back to whatever is already stored, however old: the alternative
   * is a summary that stops totalling because a free API had a bad morning. Only a base that has
   * never been fetched at all has nothing to fall back to.
   */
  async getRates(baseCode: string): Promise<ExchangeRate> {
    const base = normalizeCode(baseCode);
    const stored = await this.cache.findOneBy({ baseCode: base });
    if (stored && Date.now() - stored.fetchedAt.getTime() < CACHE_TTL_MS) {
      return stored;
    }

    try {
      return await this.refresh(base);
    } catch (error) {
      if (!stored) {
        throw new ServiceUnavailableException(`No exchange rates available for ${base}`);
      }
      this.logger.warn(`Serving ${base} rates published ${stored.publishedOn}: ${reasonFor(error)}`);
      return stored;
    }
  }

  /**
   * What one unit of `from` costs in `to`: read off the rates quoted against `to`, which are
   * refreshed first when stale, as getRates does. One lookup, no pivot currency: the provider
   * quotes the pair directly, so nothing inherits a second rounding.
   *
   * Null when there's no rate to be had — the provider doesn't quote one of the two, or nothing was
   * ever fetched against `to` and no provider answers now — for the caller to decide what that
   * means: a transfer can still take a typed amount, a series can't be set up at all.
   */
  async rateBetween(from: string, to: string): Promise<string | null> {
    if (from === to) {
      return '1';
    }
    try {
      const snapshot = await this.getRates(to);
      return snapshot.rates[normalizeCode(from)] ?? null;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        return null;
      }
      throw error;
    }
  }

  /** rateBetween, as the plain function the recurring engine takes. */
  get lookup(): RateLookup {
    return (from, to) => this.rateBetween(from, to);
  }

  /**
   * Brings the cached rates for these bases up to date where they've gone stale, one at a time and
   * never failing. The scheduler runs this before it locks anything, so the conversions it does
   * under those locks read the cache instead of waiting on a provider that may take seconds.
   */
  async warm(bases: Iterable<string>): Promise<void> {
    for (const base of new Set(bases)) {
      try {
        await this.getRates(base);
      } catch (error) {
        this.logger.warn(`Couldn't warm ${base} rates: ${reasonFor(error)}`);
      }
    }
  }

  /** The credit to show for rates a given provider quoted, including ones served from the cache. */
  attributionFor(provider: string): RateAttribution | null {
    return this.providers.find((candidate) => candidate.name === provider)?.attribution ?? null;
  }

  private async refresh(base: string): Promise<ExchangeRate> {
    const [snapshot, known] = await Promise.all([this.fetch(base), this.currencies.find()]);
    const rates = toBaseRates(
      snapshot,
      known.map((currency) => currency.code),
    );

    // Only the base itself came back, so the provider answered but covers nothing this
    // installation holds. Storing that would cache a snapshot that can never total anything.
    if (Object.keys(rates).length < 2) {
      throw new Error(`${snapshot.provider} quotes none of this installation's currencies against ${base}`);
    }

    const row = this.cache.create({
      baseCode: base,
      rates,
      publishedOn: snapshot.date,
      provider: snapshot.provider,
      fetchedAt: new Date(),
    });
    await this.cache.upsert(row, ['baseCode']);
    return row;
  }

  /** The first provider that answers wins; the rest are there for the days it doesn't. */
  private async fetch(base: string): Promise<RateSnapshot> {
    const failures: string[] = [];

    for (const provider of this.providers) {
      try {
        return await provider.getRates(base);
      } catch (error) {
        failures.push(reasonFor(error));
      }
    }

    throw new Error(`no provider answered for ${base} (${failures.join('; ')})`);
  }
}

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
