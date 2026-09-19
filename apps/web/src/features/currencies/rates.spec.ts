import { describe, expect, it } from 'vitest';
import { conversionBetween, effectiveRates, manualRatesToKeep } from './rates';

const fetched = { base: 'UAH', rates: { UAH: '1', USD: '44.68', EUR: '51.34' } };

describe('effectiveRates', () => {
  it('takes the provider rate over one typed by hand', () => {
    expect(effectiveRates('UAH', fetched, { USD: '41.5' }).USD).toEqual({ rate: '44.68', source: 'provider' });
  });

  it('fills a currency the provider does not quote from the rates typed by hand', () => {
    expect(effectiveRates('UAH', fetched, { ISK: '0.33' }).ISK).toEqual({ rate: '0.33', source: 'manual' });
  });

  it('falls back to the rates typed by hand when nothing was fetched', () => {
    expect(effectiveRates('UAH', undefined, { USD: '41.5' }).USD).toEqual({ rate: '41.5', source: 'manual' });
  });

  it('ignores fetched rates quoted against a different main currency', () => {
    // Right after switching the main currency to EUR, the cache still holds rates against UAH.
    const rates = effectiveRates('EUR', fetched, null);

    expect(rates.USD).toBeUndefined();
    expect(rates.EUR).toEqual({ rate: '1', source: 'provider' });
  });

  it('always has the main currency at 1', () => {
    expect(effectiveRates('UAH', undefined, null).UAH).toEqual({ rate: '1', source: 'provider' });
    // Even if a hand-kept rate claims otherwise.
    expect(effectiveRates('UAH', undefined, { UAH: '2' }).UAH.rate).toBe('1');
  });
});

describe('manualRatesToKeep', () => {
  it('drops the rates the provider now quotes, and trims what it keeps', () => {
    expect(manualRatesToKeep({ USD: '41.5', ISK: ' 0.33 ' }, fetched.rates)).toEqual({ ISK: '0.33' });
  });

  it('keeps every rate when the provider quotes nothing', () => {
    expect(manualRatesToKeep({ USD: '41.5' }, {})).toEqual({ USD: '41.5' });
  });
});

describe('conversionBetween', () => {
  const rates = effectiveRates('UAH', { base: 'UAH', rates: { UAH: '1', USD: '44.66806868', EUR: '51.34516634' } }, { XTS: '12.5' });

  it('converts from the main currency by the rate of the one received', () => {
    // A hryvnia is worth 1 / 44.668 dollars.
    expect(conversionBetween(rates, 'UAH', 'USD')).toEqual({ rate: '0.02238736', fetched: true });
  });

  it('converts between two other currencies through their rates against the main one', () => {
    expect(conversionBetween(rates, 'EUR', 'USD')).toEqual({ rate: '1.14948257', fetched: true });
  });

  it('says when a rate typed by hand is involved, which only the app knows of', () => {
    expect(conversionBetween(rates, 'USD', 'XTS')?.fetched).toBe(false);
  });

  it('has nothing to convert by when a rate is missing', () => {
    expect(conversionBetween(rates, 'USD', 'ISK')).toBeNull();
  });
});
