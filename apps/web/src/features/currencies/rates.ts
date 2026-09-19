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

/** How a transfer converts between two currencies, as far as the app can tell. */
export interface Conversion {
  /** What one unit of the currency sent costs in the one received, as a decimal string. */
  rate: string;
  /**
   * Both rates were fetched from the provider, so the API can convert the pair itself: on the day,
   * for a transfer ahead, and each time, for a series. A rate typed by hand only exists here.
   */
  fetched: boolean;
}

// What the API takes for a rate: at most 12 digits before the point and 8 after.
const MAX_RATE = 1e12;

/**
 * The conversion from `from` to `to`, worked out from their rates against the main currency — one
 * divided by the other. Both come from the same answer, so the pair is as the provider quotes it,
 * short of the eighth decimal. Null when either rate is missing.
 */
export function conversionBetween(rates: Record<string, Rate>, from: string, to: string): Conversion | null {
  const sent = rates[from];
  const received = rates[to];
  if (!sent || !received) {
    return null;
  }
  const ratio = Number(sent.rate) / Number(received.rate);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= MAX_RATE) {
    return null;
  }
  // Trailing zeros go before the point does, so a whole number keeps its own: "100".
  const rate = ratio.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  if (rate === '0') {
    return null;
  }
  return { rate, fetched: sent.source === 'provider' && received.source === 'provider' };
}
