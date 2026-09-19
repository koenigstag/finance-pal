/**
 * Rates for one base currency, exactly as a single provider published them.
 *
 * Providers disagree by a few tenths of a percent and each publishes on its own schedule, so a
 * snapshot carries its own provenance: whoever freezes a rate onto a transaction can record which
 * provider quoted it and which day it was published, and the number stays explainable later.
 */
export interface RateSnapshot {
  /** Uppercase ISO 4217 code the rates are quoted against. */
  base: string;
  /**
   * Publication day the provider reported, as YYYY-MM-DD — not necessarily today. currency-api's
   * CDN has served two bases a day apart, and open.er-api refreshes once every 24 hours.
   */
  date: string;
  /** Uppercase code -> units of that currency per 1 unit of `base`. */
  rates: Record<string, number>;
  /** `name` of the provider that answered, stored alongside a frozen rate. */
  provider: string;
}

/** A credit a provider's terms require to stay visible wherever its rates are shown. */
export interface RateAttribution {
  text: string;
  url: string;
}

export interface RateProvider {
  /** Stable identifier, safe to persist next to a rate this provider quoted. */
  readonly name: string;
  /** Set when the terms require a visible credit; render it wherever these rates appear. */
  readonly attribution?: RateAttribution;
  /**
   * Latest rates quoted against `base`, which may be any currency the provider covers.
   * Throws RateProviderError when the provider is unreachable or answers with something unusable,
   * so a caller can move on to the next provider without inspecting messages.
   */
  getRates(base: string): Promise<RateSnapshot>;
}

/** The providers in fallback order: try each until one answers. */
export const RATE_PROVIDERS = Symbol('RATE_PROVIDERS');

/** Overrides the per-request timeout; every provider treats a slow answer as no answer. */
export const RATE_REQUEST_TIMEOUT_MS = Symbol('RATE_REQUEST_TIMEOUT_MS');

export const DEFAULT_RATE_TIMEOUT_MS = 5_000;

export class RateProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`${provider}: ${message}`, options);
    this.name = 'RateProviderError';
  }
}

/**
 * Guards the code before it goes into a URL path and keeps lookups case-insensitive. A bad code is
 * a caller's bug rather than a provider outage, so this throws TypeError: raising
 * RateProviderError would send the fallback chain off to fail identically against every provider.
 */
export function normalizeCode(base: string): string {
  const code = base.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new TypeError(`"${base}" is not a 3-letter currency code`);
  }
  return code;
}

/**
 * Normalizes a provider's rate map to uppercase codes. currency-api mixes crypto and metals in
 * among the currencies, which is harmless — callers only look up the codes they hold. Entries that
 * aren't positive finite numbers are dropped instead of failing the snapshot: these feeds carry
 * hundreds of keys and one bad line shouldn't cost every other rate.
 */
export function toRateMap(raw: Record<string, unknown>): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      rates[code.toUpperCase()] = value;
    }
  }
  return rates;
}
