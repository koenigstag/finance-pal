import { isPercentageInRange, parseMoneyInput, percentageSchema } from '@ft/shared-contracts';

// Shared with the API, whose external endpoints read amounts other apps send the same way.
export { parseMoneyInput };

/**
 * Turns a typed percentage into the API's form ("3,5" → "3.5"), or null unless it's above zero, at
 * most 100 and has no more than four decimals.
 */
export function parsePercentageInput(input: string): string | null {
  const normalized = input
    .replace(/\s/g, '')
    .replace(/%$/, '')
    .replace(',', '.')
    .replace(/\.$/, '')
    .replace(/^0+(?=\d)/, '');
  return percentageSchema.safeParse(normalized).success && isPercentageInRange(normalized) ? normalized : null;
}

/** The sign of a money string, read from its text (no float parsing): "-0.00" and "0" are zero. */
export function moneySign(amount: string): -1 | 0 | 1 {
  if (!/[1-9]/.test(amount)) {
    return 0;
  }
  return amount.trim().startsWith('-') ? -1 : 1;
}

/**
 * The exact sum of signed money strings ("12.5" + "-0.25" → "12.25"), in integer arithmetic so no
 * float rounding creeps in. Keeps as many decimals as the most precise input.
 */
export function sumMoney(amounts: string[]): string {
  const scale = Math.max(0, ...amounts.map((amount) => amount.split('.')[1]?.length ?? 0));
  const factor = 10n ** BigInt(scale);
  const total = amounts.reduce((sum, amount) => {
    const negative = amount.trim().startsWith('-');
    const [whole, fraction = ''] = amount.trim().replace(/^[-+]/, '').split('.');
    const units = BigInt(whole || '0') * factor + BigInt(fraction.padEnd(scale, '0') || '0');
    return sum + (negative ? -units : units);
  }, 0n);
  const magnitude = total < 0n ? -total : total;
  const whole = (magnitude / factor).toString();
  const fraction = scale > 0 ? `.${(magnitude % factor).toString().padStart(scale, '0')}` : '';
  return `${total < 0n ? '-' : ''}${whole}${fraction}`;
}

/**
 * An amount in one currency valued in another: `amount` times `rate`, rounded to the cent (half
 * away from zero, as money rounding is read). Integer arithmetic throughout — a rate has up to
 * eight decimals, which a float would already be approximating.
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

/** An amount the API will accept for a transaction: well-formed and above zero. */
export function isValidAmountInput(input: string): boolean {
  const amount = parseMoneyInput(input);
  return amount !== null && /[1-9]/.test(amount);
}

/**
 * Display-only formatting. The Number() conversion never feeds back into stored or summed
 * values, so float rounding can't accumulate — it's one conversion per rendered figure.
 *
 * `currencyDisplay: 'narrowSymbol'` prefers the bare sign where Intl has one (₴ rather than "UAH"
 * in English), for tight spots; currencies without one keep their code.
 */
export function formatMoney(
  amount: string,
  currencyCode: string | undefined,
  locale: string,
  { currencyDisplay = 'symbol' }: { currencyDisplay?: 'symbol' | 'narrowSymbol' } = {},
): string {
  const value = Number(amount);
  if (!currencyCode) {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  }
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode, currencyDisplay }).format(value);
}

/** Display-only, like formatMoney: "3.5" as 3.5% in English, 3,5 % in Russian. */
export function formatPercentage(percentage: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 4 }).format(Number(percentage) / 100);
}
