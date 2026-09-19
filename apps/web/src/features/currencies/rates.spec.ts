import { describe, expect, it } from 'vitest';
import { effectiveRates, manualRatesToKeep } from './rates';

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
