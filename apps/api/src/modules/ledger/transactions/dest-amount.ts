import { convertMoney, isPositiveMoney } from '@ft/shared-contracts';

/**
 * What a write does to a transfer's received amount — the amount that arrives when the two
 * accounts are in different currencies:
 * - `typed`: the user named a figure. It stands as given, and no rate ever overrides it.
 * - `convert`: work it out from the exchange rate now.
 * - `keep`: leave the stored one, and how it was arrived at, as they are.
 */
export type DestPlan = { kind: 'typed'; destAmount: string } | { kind: 'convert' } | { kind: 'keep' };

export interface StoredDest {
  destAmount: string | null;
  destAmountAsOf: Date | null;
  // Whether the stored figure was for the same two currencies as after this write.
  sameCurrencies: boolean;
}

/**
 * How a write between two currencies settles the received amount. `requested` is what the write
 * says about it: a figure, null to have it converted, or undefined when it doesn't say — which a
 * create reads as null, there being nothing stored to keep.
 *
 * Unnamed on an update, the stored figure stays when it still means something: typed by the user,
 * or converted and since fixed on its day. It's converted afresh when it no longer can — it was for
 * another pair of currencies, there wasn't one, or it's an estimate at the new date, which follows
 * the rate until that date comes. Moved to today or earlier, an estimate so lands at today's rate.
 */
export function planDestAmount(requested: string | null | undefined, stored: StoredDest | null, date: Date): DestPlan {
  if (typeof requested === 'string') {
    return { kind: 'typed', destAmount: requested };
  }
  if (requested === null || stored === null || !stored.sameCurrencies) {
    return { kind: 'convert' };
  }
  if (stored.destAmount === null && stored.destAmountAsOf === null) {
    return { kind: 'convert' };
  }
  if (stored.destAmountAsOf !== null && stored.destAmountAsOf.getTime() < date.getTime()) {
    return { kind: 'convert' };
  }
  return { kind: 'keep' };
}

/**
 * `amount` at `rate`, as a received amount. Nothing for an amount that is nothing (an estimate from
 * a balance can be, for now): there's nothing to receive, and null credits nothing. Never below a
 * cent for something sent, which would read as nothing received.
 */
export function convertedDest(amount: string, rate: string): string | null {
  if (!isPositiveMoney(amount)) {
    return null;
  }
  const converted = convertMoney(amount, rate);
  return isPositiveMoney(converted) ? converted : '0.01';
}
