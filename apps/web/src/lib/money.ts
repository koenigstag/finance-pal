import {
  convertMoney,
  isPercentageInRange,
  parseMoneyInput,
  percentageSchema,
  percentOf,
  roundBalanceAmount,
} from '@ft/shared-contracts';

// Shared with the API: its external endpoints read amounts other apps send the same way, and it
// works percentages and roundings out to the same cent the app does.
export { convertMoney, parseMoneyInput, percentOf, roundBalanceAmount };

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
