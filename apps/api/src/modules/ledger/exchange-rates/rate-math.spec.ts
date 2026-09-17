import { invertRate, toBaseRates } from './rate-math';
import type { RateSnapshot } from './rate-provider';

function snapshot(rates: Record<string, number>): RateSnapshot {
  return { base: 'UAH', date: '2026-09-18', rates, provider: 'currency-api' };
}

describe('invertRate', () => {
  it('turns a quote into what one unit costs in the base', () => {
    // 1 UAH buys 0.0224 USD, so a dollar costs a little under 45 hryvnia.
    expect(invertRate(0.022389249)).toBe('44.66429401');
  });

  it('drops the padding zeros but keeps a whole number whole', () => {
    expect(invertRate(0.5)).toBe('2');
    expect(invertRate(0.01)).toBe('100');
  });

  it('refuses a quote that is not a positive number', () => {
    expect(invertRate(0)).toBeNull();
    expect(invertRate(-1)).toBeNull();
    expect(invertRate(Number.NaN)).toBeNull();
    expect(invertRate(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('refuses the ends of the range the contract cannot express', () => {
    // A quote this small inverts past 12 digits; one this large rounds away at 8 decimals.
    expect(invertRate(1e-13)).toBeNull();
    expect(invertRate(1e9)).toBeNull();
  });
});

describe('toBaseRates', () => {
  it('keeps only the currencies this installation knows, inverted', () => {
    const rates = toBaseRates(snapshot({ USD: 0.025, EUR: 0.02, DOGE: 123.4 }), ['USD', 'EUR', 'UAH']);

    expect(rates).toEqual({ UAH: '1', USD: '40', EUR: '50' });
  });

  it('includes the base itself at 1, whatever the provider quoted for it', () => {
    expect(toBaseRates(snapshot({ UAH: 1, USD: 0.025 }), ['UAH', 'USD']).UAH).toBe('1');
  });

  it('leaves out a known currency the provider does not quote', () => {
    const rates = toBaseRates(snapshot({ USD: 0.025 }), ['USD', 'ISK']);

    expect(rates).toEqual({ UAH: '1', USD: '40' });
  });
});
