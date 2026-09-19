import type { RoundBalanceStep } from './round-balance.schema.js';

// Arithmetic on money strings, shared by the app and the API so that both work an amount out to
// the same cent: integers (BigInt) throughout, since a float would already be approximating.

/**
 * An amount in one currency valued in another: `amount` times `rate`, rounded to the cent (half
 * away from zero, as money rounding is read). A rate has up to eight decimals.
 */
export function convertMoney(amount: string, rate: string): string {
  const [value, valueScale] = toUnits(amount);
  const [factor, factorScale] = toUnits(rate);
  return roundToCents(value * factor, valueScale + factorScale);
}

/**
 * `percentage` per cent of an amount, whatever its sign — 3.5% of a -1234.00 balance is 43.19 —
 * rounded to the cent as convertMoney rounds.
 */
export function percentOf(amount: string, percentage: string): string {
  const [value, valueScale] = toUnits(amount);
  const [rate, rateScale] = toUnits(percentage);
  // Per cent: two more decimals than the rate is written with.
  return roundToCents((value < 0n ? -value : value) * rate, valueScale + rateScale + 2);
}

/**
 * The amount that leaves a balance on a multiple of `step` once it has gone through. Money going
 * out (an expense, a transfer) takes the balance down to the multiple below: 34.56 of 1,234.56 to
 * 100, and 65.44 of -1,234.56, down to -1,300. Money coming in (an income) takes it up to the one
 * above: 65.44 to make 1,234.56 into 1,300. "0.00" when the balance is on one already.
 */
export function roundBalanceAmount(balance: string, step: RoundBalanceStep, direction: 'out' | 'in'): string {
  const [units, scale] = toUnits(balance);
  // In cents: a balance carries at most two decimals.
  const cents = scale <= 2 ? units * 10n ** BigInt(2 - scale) : units / 10n ** BigInt(scale - 2);
  const stepCents = BigInt(step) * 100n;
  // How far the balance sits above the multiple below it: from nothing to just short of a step.
  const above = ((cents % stepCents) + stepCents) % stepCents;
  const amount = direction === 'out' ? above : (stepCents - above) % stepCents;
  return `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
}

// An integer carrying `scale` decimals, rounded to the cent (half away from zero, as money rounding
// is read). Taken to tenths of a cent first, so the last digit is the one to round on.
function roundToCents(units: bigint, scale: number): string {
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const shift = scale - 3;
  const tenths = shift <= 0 ? magnitude * 10n ** BigInt(-shift) : magnitude / 10n ** BigInt(shift);
  const cents = (tenths + 5n) / 10n;
  const fraction = (cents % 100n).toString().padStart(2, '0');
  return `${negative && cents > 0n ? '-' : ''}${cents / 100n}.${fraction}`;
}

// A decimal string as an integer and the number of decimals it carried.
function toUnits(input: string): [bigint, number] {
  const trimmed = input.trim();
  const negative = trimmed.startsWith('-');
  const [whole, fraction = ''] = trimmed.replace(/^[-+]/, '').split('.');
  const units = BigInt(`${whole || '0'}${fraction}`);
  return [negative ? -units : units, fraction.length];
}
