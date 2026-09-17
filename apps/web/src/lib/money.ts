import { moneySchema } from '@ft/shared-contracts';

/**
 * Turns what someone typed into the API's money string ("1 234,5" → "1234.5"), or null if it
 * isn't an amount. Money stays a string end to end; this only normalizes separators.
 */
export function parseMoneyInput(input: string): string | null {
  const normalized = input
    // \s includes the no-break and narrow no-break spaces locales use for digit grouping.
    .replace(/\s/g, '')
    .replace(',', '.')
    // "12." is a half-typed "12.50"; accept it as 12.
    .replace(/\.$/, '')
    // "012" from typing after a leftover zero; keep a single zero before the point ("0.5").
    .replace(/^0+(?=\d)/, '');
  return moneySchema.safeParse(normalized).success ? normalized : null;
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
  const product = value * factor;
  const negative = product < 0n;
  const magnitude = negative ? -product : product;
  // Taken to tenths of a cent first, so the last digit is the one to round on.
  const shift = valueScale + factorScale - 3;
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
