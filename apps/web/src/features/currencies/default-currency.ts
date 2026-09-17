// Currency by ISO region, for the currencies the app offers (see the seed-currencies migration).
const EURO_REGIONS = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];

const CURRENCY_BY_REGION: Record<string, string> = {
  ...Object.fromEntries(EURO_REGIONS.map((region) => [region, 'EUR'])),
  US: 'USD',
  GB: 'GBP',
  RU: 'RUB',
  UA: 'UAH',
  KZ: 'KZT',
  PL: 'PLN',
  CZ: 'CZK',
  TR: 'TRY',
  CN: 'CNY',
  JP: 'JPY',
  CH: 'CHF',
  LI: 'CHF',
  GE: 'GEL',
  AM: 'AMD',
  AE: 'AED',
};

const FALLBACK_CURRENCY = 'USD';

/**
 * The currency a locale implies, through its region: "en-GB" → GBP. A bare language is expanded
 * to its most likely region first ("ru" → ru-Cyrl-RU → RUB, "en" → en-Latn-US → USD).
 */
export function currencyCodeForLocale(locale: string): string | undefined {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region ? CURRENCY_BY_REGION[region] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The locale to take a currency from for a chosen UI language: the browser's own locale when it
 * is in that language (so en-GB keeps GBP), otherwise the language alone.
 */
export function localeForLanguage(language: string, browserLocale: string): string {
  return browserLocale.toLowerCase().startsWith(`${language.toLowerCase()}-`) ? browserLocale : language;
}

interface CurrencyLike {
  id: number;
  code: string;
}

/** The id of the currency to preselect, falling back to USD, then to whatever comes first. */
export function defaultCurrencyId(currencies: CurrencyLike[], locale: string): number | undefined {
  const byCode = (code: string | undefined) => currencies.find((currency) => currency.code === code)?.id;
  return byCode(currencyCodeForLocale(locale)) ?? byCode(FALLBACK_CURRENCY) ?? currencies[0]?.id;
}
