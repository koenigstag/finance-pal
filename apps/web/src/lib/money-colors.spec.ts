import { describe, expect, it } from 'vitest';
import { MONEY_COLORS, signColor, transactionTypeColor } from './money-colors';

describe('money colors', () => {
  it('colors balances by sign', () => {
    expect(signColor(1)).toBe(MONEY_COLORS.positive);
    expect(signColor(-1)).toBe(MONEY_COLORS.negative);
    expect(signColor(0)).toBe(MONEY_COLORS.neutral);
  });

  it('colors transactions by type', () => {
    expect(transactionTypeColor('income')).toBe(MONEY_COLORS.positive);
    expect(transactionTypeColor('expense')).toBe(MONEY_COLORS.negative);
    expect(transactionTypeColor('transfer')).toBe(MONEY_COLORS.neutral);
  });
});
