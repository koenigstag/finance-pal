import { describe, expect, it } from 'vitest';
import { convertMoney, formatMoney, isValidAmountInput, moneySign, sumMoney } from './money';

describe('moneySign', () => {
  it.each([
    ['12.50', 1],
    ['0.01', 1],
    ['-3.00', -1],
    ['0.00', 0],
    ['-0.00', 0],
    ['0', 0],
  ])('%s → %i', (amount, sign) => {
    expect(moneySign(amount)).toBe(sign);
  });
});

describe('isValidAmountInput', () => {
  it('requires an amount above zero', () => {
    expect(isValidAmountInput('0')).toBe(false);
    expect(isValidAmountInput('0.00')).toBe(false);
    expect(isValidAmountInput('0.01')).toBe(true);
    expect(isValidAmountInput('10')).toBe(true);
    expect(isValidAmountInput('x')).toBe(false);
  });
});

describe('formatMoney', () => {
  it('formats with the currency', () => {
    expect(formatMoney('1234.5', 'USD', 'en-US')).toBe('$1,234.50');
  });

  it('can use the narrow symbol instead of a code', () => {
    // Intl separates a code from the number with a no-break space.
    expect(formatMoney('1234.5', 'UAH', 'en-US')).toBe('UAH 1,234.50');
    expect(formatMoney('1234.5', 'UAH', 'en-US', { currencyDisplay: 'narrowSymbol' })).toBe('₴1,234.50');
  });

  it('keeps the sign of a negative balance', () => {
    expect(formatMoney('-20', 'EUR', 'en-US')).toBe('-€20.00');
  });

  it('falls back to a plain number without a currency', () => {
    expect(formatMoney('3', undefined, 'en-US')).toBe('3.00');
  });
});

describe('sumMoney', () => {
  it.each([
    [[], '0'],
    [['12.5', '-0.25'], '12.25'],
    [['0.1', '0.2'], '0.3'],
    [['-100', '40.00'], '-60.00'],
    [['-0.05', '0.01'], '-0.04'],
    [['1000000000000.99', '1.01'], '1000000000002.00'],
  ])('sums %j to %j', (amounts, expected) => {
    expect(sumMoney(amounts)).toBe(expected);
  });
});

describe('convertMoney', () => {
  it.each([
    ['100', '41.5', '4150.00'],
    ['0.01', '41.5', '0.42'],
    ['-59251.05', '1', '-59251.05'],
    ['1296584.50', '0.02350512', '30476.37'],
    ['0', '41.5', '0.00'],
    ['1', '0.005', '0.01'],
    ['1', '0.004', '0.00'],
  ])('values %j at %j as %j', (amount, rate, expected) => {
    expect(convertMoney(amount, rate)).toBe(expected);
  });
});
