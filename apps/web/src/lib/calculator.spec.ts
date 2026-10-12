import { describe, expect, it } from 'vitest';
import { displayFormula, evaluateFormula, formulaAmount, pressKey, type CalculatorKey } from './calculator';

// The formula a run of keys types, from an empty one.
const typed = (keys: string, from = '') => [...keys].reduce((formula, key) => pressKey(formula, key as CalculatorKey), from);

describe('pressKey', () => {
  it.each([
    ['12+3', '12+3'],
    // An operator in place of the one before it.
    ['12+*3', '12*3'],
    ['12*-3', '12*-3'],
    ['12*-+3', '12+3'],
    ['12--3', '12-3'],
    // Only a minus can start a number.
    ['*+5', '5'],
    ['-5', '-5'],
    ['(*5', '(5'],
    ['(-5', '(-5'],
    // A lone zero gives way; a zero within a number stays.
    ['05', '5'],
    ['00', '0'],
    ['105', '105'],
    ['1+05', '1+5'],
    ['0,05', '0,05'],
    // A comma starts a number with a zero, and a number takes one.
    [',5', '0,5'],
    ['2+,5', '2+0,5'],
    ['1,2,3', '1,23'],
    // A half-typed comma goes once something else follows.
    ['5,+1', '5+1'],
    ['5,%', '5%'],
    ['(5,)', '(5)'],
    // Brackets close only what's open, and only after a value.
    ['5)', '5'],
    ['(5+)', '(5+'],
    ['((5)', '((5)'],
    // Right after a value, a bracket or a number multiplies it.
    ['2(3)', '2*(3)'],
    ['(2)3', '(2)*3'],
    ['5%2', '5%*2'],
    // A percentage follows a value, once.
    ['%5', '5'],
    ['5%%', '5%'],
    ['5+%', '5+'],
  ])('types %j as %j', (keys, formula) => {
    expect(typed(keys)).toBe(formula);
  });
});

describe('formulaAmount', () => {
  it.each([
    ['250', '250'],
    ['12,5', '12.5'],
    ['12,50', '12.50'],
    ['12,', '12'],
    ['0', '0'],
  ])('reads %j as the amount %j', (formula, amount) => {
    expect(formulaAmount(formula)).toBe(amount);
  });

  // Something left to work out: an operation, a sign, more than cents, more than an amount holds.
  it.each(['', '2+3', '-5', '(5)', '5%', '1,234', '1234567890123'])('has nothing for %j', (formula) => {
    expect(formulaAmount(formula)).toBeNull();
  });
});

describe('evaluateFormula', () => {
  it.each([
    ['2+3*4', '14'],
    ['(2+3)*4', '20'],
    ['10/4', '2,5'],
    ['0,1+0,2', '0,3'],
    ['100/3', '33,33'],
    ['2/3', '0,67'],
    ['0,005', '0,01'],
    ['1,234', '1,23'],
    ['12,50', '12,5'],
    ['1,5*2', '3'],
    // Without a sign: an amount has none.
    ['30-50', '20'],
    ['-12', '12'],
    ['5*-2', '10'],
    // Brackets left open close at the end.
    ['(2+3', '5'],
    ['2*(3+(1', '8'],
    // Per cent of what + and − add it to, otherwise a hundredth.
    ['200-15%', '170'],
    ['200+15%', '230'],
    ['200*15%', '30'],
    ['200/50%', '400'],
    ['15%', '0,15'],
    ['(100+100)-10%', '180'],
    ['200-(10+5)%', '170'],
    ['200-15%*2', '199,7'],
  ])('works %j out to %j', (formula, result) => {
    expect(evaluateFormula(formula)).toEqual({ formula: result });
  });

  it.each([
    ['', 'incomplete'],
    ['5+', 'incomplete'],
    ['5*-', 'incomplete'],
    ['()', 'incomplete'],
    ['5/0', 'divisionByZero'],
    ['5/(2-2)', 'divisionByZero'],
    ['999999999999*10', 'tooLarge'],
  ])('refuses %j as %j', (formula, error) => {
    expect(evaluateFormula(formula)).toEqual({ error });
  });

  it('keeps the largest amount there is', () => {
    expect(evaluateFormula('999999999999,99')).toEqual({ formula: '999999999999,99' });
  });
});

describe('displayFormula', () => {
  it.each([
    ['1234567,891', '1\u202f234\u202f567,891'],
    ['1500*2-15%', '1\u202f500\u00a0× 2\u00a0− 15%'],
    ['-5/(2*-3)', '−5\u00a0÷ (2\u00a0× −3)'],
    ['12+', '12\u00a0+ '],
  ])('shows %j as %j', (formula, shown) => {
    expect(displayFormula(formula)).toBe(shown);
  });
});
