/** Where a rate came from: fetched by the API from a rate provider, or typed in by the user. */
export type RateSource = 'provider' | 'manual';

export interface Rate {
  /** What one unit of the currency costs in the main one, as a decimal string. */
  rate: string;
  source: RateSource;
}

/**
 * Every rate against the user's main currency, keyed by code. The provider's where it quotes one,
 * the user's own where it doesn't: a rate typed in by hand only fills a gap, it never overrides a
 * fetched one, which is at most a day old.
 *
 * `fetched` only counts when it was quoted against `baseCode`. Right after the main currency changes
 * the cached answer can still be against the old one, and its numbers would be off by a whole rate.
 *
 * The main currency itself is always here at 1, whatever either source has, so a total can look up
 * every currency on show the same way and never find its own missing.
 */
export function effectiveRates(
  baseCode: string,
  fetched: { base: string; rates: Record<string, string> } | undefined,
  manual: Record<string, string> | null | undefined,
): Record<string, Rate> {
  const rates: Record<string, Rate> = {};

  for (const [code, rate] of Object.entries(manual ?? {})) {
    rates[code] = { rate, source: 'manual' };
  }
  if (fetched?.base === baseCode) {
    for (const [code, rate] of Object.entries(fetched.rates)) {
      rates[code] = { rate, source: 'provider' };
    }
  }
  rates[baseCode] = { rate: '1', source: 'provider' };

  return rates;
}

/**
 * The hand-kept rates worth saving: the ones for currencies the provider doesn't quote. A rate typed
 * before the provider covered its currency is dropped on the next save, rather than kept as a second
 * answer nobody sees.
 */
export function manualRatesToKeep(
  manual: Record<string, string>,
  fetched: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(manual)
      .filter(([code]) => !(code in fetched))
      .map(([code, rate]) => [code, rate.trim()]),
  );
}
