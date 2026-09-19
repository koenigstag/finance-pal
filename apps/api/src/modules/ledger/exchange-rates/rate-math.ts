import type { RateSnapshot } from './rate-provider';

// What the contract accepts: at most 12 digits before the point and 8 after.
const MAX_RATE = 1e12;
const SCALE = 8;

/**
 * Turns a provider's quote around. Providers answer "units of X per 1 unit of base"; every total
 * in the app asks the opposite — what one unit of X costs in the base — so each rate is inverted
 * once here, on the way into the cache, rather than at each use.
 *
 * Returns null for anything that cannot be expressed as a rate: a quote at or below zero, and the
 * far ends of the range, where inverting overflows the 12 digits the contract allows or rounds
 * away to nothing at 8 decimal places.
 */
export function invertRate(quoted: number): string | null {
  if (!Number.isFinite(quoted) || quoted <= 0) {
    return null;
  }

  const inverted = 1 / quoted;
  if (!Number.isFinite(inverted) || inverted >= MAX_RATE) {
    return null;
  }

  // The trailing zeros go before the point does, so a whole number keeps its zeros: 100.00000000
  // loses the eight decimals and stays "100".
  const fixed = inverted.toFixed(SCALE).replace(/0+$/, '').replace(/\.$/, '');
  return fixed === '0' ? null : fixed;
}

/**
 * A provider's snapshot as the app stores it: inverted, and narrowed to the currencies this
 * installation actually knows about. The providers quote hundreds of codes, most of them crypto
 * and metals nobody here holds an account in.
 *
 * The base itself is included at "1", so a caller can look up every currency on screen the same
 * way instead of special-casing its own.
 */
export function toBaseRates(snapshot: RateSnapshot, known: readonly string[]): Record<string, string> {
  const rates: Record<string, string> = { [snapshot.base]: '1' };

  for (const code of known) {
    if (code === snapshot.base) {
      continue;
    }
    const quoted = snapshot.rates[code];
    const inverted = quoted === undefined ? null : invertRate(quoted);
    if (inverted) {
      rates[code] = inverted;
    }
  }

  return rates;
}
