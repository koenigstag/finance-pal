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
