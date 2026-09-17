import { describe, expect, it } from 'vitest';
import { currencyCodeForLocale, defaultCurrencyId, localeForLanguage } from './default-currency';

describe('currencyCodeForLocale', () => {
  it.each([
    ['ru', 'RUB'],
    ['ru-RU', 'RUB'],
    ['en', 'USD'],
    ['en-US', 'USD'],
    ['en-GB', 'GBP'],
    ['de-DE', 'EUR'],
    ['de-CH', 'CHF'],
    ['uk-UA', 'UAH'],
    ['kk', 'KZT'],
  ])('%s → %s', (locale, expected) => {
    expect(currencyCodeForLocale(locale)).toBe(expected);
  });

  it('knows nothing about regions without an offered currency or invalid tags', () => {
    expect(currencyCodeForLocale('pt-BR')).toBeUndefined();
    expect(currencyCodeForLocale('not a locale')).toBeUndefined();
  });
});

describe('localeForLanguage', () => {
  it("keeps the browser's region when the language matches it", () => {
    expect(localeForLanguage('en', 'en-GB')).toBe('en-GB');
  });

  it('uses the bare language otherwise', () => {
    expect(localeForLanguage('ru', 'en-GB')).toBe('ru');
    expect(localeForLanguage('en', 'ru-RU')).toBe('en');
  });
});

describe('defaultCurrencyId', () => {
  const currencies = [
    { id: 1, code: 'USD' },
    { id: 2, code: 'EUR' },
    { id: 4, code: 'RUB' },
  ];

  it('picks the locale currency', () => {
    expect(defaultCurrencyId(currencies, 'ru')).toBe(4);
  });

  it('falls back to USD, then to the first currency', () => {
    expect(defaultCurrencyId(currencies, 'pt-BR')).toBe(1);
    expect(defaultCurrencyId([{ id: 7, code: 'PLN' }], 'pt-BR')).toBe(7);
  });
});
