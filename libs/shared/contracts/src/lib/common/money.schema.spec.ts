import { parseMoneyInput } from './money.schema.js';

describe('parseMoneyInput', () => {
  it.each([
    ['12', '12'],
    ['12.5', '12.5'],
    ['12,50', '12.50'],
    ['1 234,56', '1234.56'],
    // The no-break and narrow no-break spaces locales group digits with.
    ['1\u00a0234.5', '1234.5'],
    ['1\u202f234', '1234'],
    ['12.', '12'],
    [' 7 ', '7'],
    ['012', '12'],
    ['00.5', '0.5'],
    ['0', '0'],
  ])('accepts %j as %j', (input, expected) => {
    expect(parseMoneyInput(input)).toBe(expected);
  });

  // "1.234" and "1,234" could each be a thousand or three decimals, so neither is guessed at.
  it.each(['', 'abc', '-5', '1.234', '1,234', '12.3.4', '1,2,3', '1,234.50', '1e5', '1234567890123', '12 UAH'])(
    'rejects %j',
    (input) => {
      expect(parseMoneyInput(input)).toBeNull();
    },
  );
});
