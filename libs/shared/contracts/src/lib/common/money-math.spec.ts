import { percentOf, roundBalanceAmount } from './money-math.js';

describe('roundBalanceAmount', () => {
  it.each([
    ['1234.56', 100, '34.56'],
    ['1234.56', 1, '0.56'],
    ['1234.56', 10, '4.56'],
    ['1234.56', 1000, '234.56'],
    // Down from a debt goes further into it: -1,234.56 to -1,300.
    ['-1234.56', 100, '65.44'],
    ['5.5', 10, '5.50'],
  ] as const)('takes %s going out down to a multiple of %s with %s', (balance, step, amount) => {
    expect(roundBalanceAmount(balance, step, 'out')).toBe(amount);
  });

  it.each([
    ['1234.56', 100, '65.44'],
    ['1234.56', 1, '0.44'],
    ['1234.56', 10, '5.44'],
    // Up from a debt pays it down: -1,234.56 to -1,200.
    ['-1234.56', 100, '34.56'],
  ] as const)('takes %s coming in up to a multiple of %s with %s', (balance, step, amount) => {
    expect(roundBalanceAmount(balance, step, 'in')).toBe(amount);
  });

  it('comes to nothing for a balance on a multiple already', () => {
    expect(roundBalanceAmount('1200.00', 100, 'out')).toBe('0.00');
    expect(roundBalanceAmount('1200', 100, 'in')).toBe('0.00');
    expect(roundBalanceAmount('-3000.00', 1000, 'out')).toBe('0.00');
    expect(roundBalanceAmount('0', 10, 'in')).toBe('0.00');
  });
});

describe('percentOf', () => {
  it('takes the percentage of a balance whatever its sign, to the cent', () => {
    expect(percentOf('-11556.00', '3')).toBe('346.68');
    expect(percentOf('19399.97', '3')).toBe('582.00');
    // numeric(7,4) as Postgres reads it back.
    expect(percentOf('1234.00', '3.5000')).toBe('43.19');
  });
});
