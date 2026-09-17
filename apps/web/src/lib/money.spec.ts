import { describe, expect, it } from 'vitest';
import { formatMoney, isValidAmountInput, parseMoneyInput } from './money';

describe('parseMoneyInput', () => {
  it.each([
    ['12', '12'],
    ['12.5', '12.5'],
    ['12,50', '12.50'],
    ['1 234,56', '1234.56'],
    ['1 234.5', '1234.5'],
    ['1 234', '1234'],
    ['12.', '12'],
    [' 7 ', '7'],
    ['012', '12'],
    ['00.5', '0.5'],
    ['0', '0'],
  ])('accepts %j as %j', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '1.234', '12.3.4', '1,2,3', '1e5', '1234567890123'])('rejects %j', (input) => {
    expect(parseMoneyInput(input)).toBeNull();
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

  it('keeps the sign of a negative balance', () => {
    expect(formatMoney('-20', 'EUR', 'en-US')).toBe('-€20.00');
  });

  it('falls back to a plain number without a currency', () => {
    expect(formatMoney('3', undefined, 'en-US')).toBe('3.00');
  });
});
