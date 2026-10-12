import Fraction from 'fraction.js';
import { parseMoneyInput } from '@/lib/money';

// A calculator's formula: a string typed key by key, and worked out only on "=". It's kept as the
// keys typed it — a comma for the decimal separator, + - * / and a postfix %, with brackets — and
// shown with proper signs by displayFormula. Worked out in fractions (fraction.js), so 0,1 + 0,2
// is 0,3 and a third of 100 is 33,33 rather than whatever a float makes of either.
//
// The reading is this module's own: the expression libraries there are take `%` before a + or −
// for a remainder (mathjs works 200 − 15% − 5 out to 200), or don't take it at all.

// '()' is the keypad's one key for both brackets, which opens or closes one as the formula needs.
export type CalculatorKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | ','
  | Operator
  | '%'
  | '('
  | ')'
  | '()';
type Operator = '+' | '-' | '*' | '/';

export type CalculatorError = 'incomplete' | 'divisionByZero' | 'tooLarge';
export type Evaluation = { formula: string } | { error: CalculatorError };

const OPERATORS = new Set(['+', '-', '*', '/']);
const isDigit = (char: string | undefined) => char !== undefined && char >= '0' && char <= '9';
const isOperator = (char: string | undefined) => char !== undefined && OPERATORS.has(char);
// A number, a closed bracket or a percentage: something an operator can follow.
const endsWithValue = (formula: string) => /[\d,)%]$/.test(formula);
const openBrackets = (formula: string) => formula.split('(').length - formula.split(')').length;

/**
 * The formula once a key is pressed, as a calculator's keypad would let it become: an operator
 * typed after another takes its place (bar a minus after × or ÷, which makes the next number
 * negative), a lone 0 gives way to the digit typed after it, and a bracket or a number right after a
 * value multiplies it. A key that can't follow what's there is ignored.
 */
export function pressKey(formula: string, key: CalculatorKey): string {
  const last = formula.at(-1);
  // A half-typed "12," is 12 to whatever comes after it but more of its own digits.
  const settled = formula.replace(/,$/, '');
  if (isDigit(key)) {
    if (last === ')' || last === '%') {
      return `${formula}*${key}`;
    }
    return /(^|[^\d,])0$/.test(formula) ? `${formula.slice(0, -1)}${key}` : `${formula}${key}`;
  }
  switch (key) {
    case '()':
      // Closes one that's open once there's a value to close it on; opens another otherwise.
      return pressKey(formula, endsWithValue(formula) && openBrackets(formula) > 0 ? ')' : '(');
    case ',':
      if (last === ')' || last === '%' || /,\d*$/.test(formula)) {
        return formula;
      }
      return isDigit(last) ? `${formula},` : `${formula}0,`;
    case '(':
      return endsWithValue(formula) ? `${settled}*(` : `${formula}(`;
    case ')':
      return endsWithValue(formula) && openBrackets(formula) > 0 ? `${settled})` : formula;
    case '%':
      return isDigit(last) || last === ',' || last === ')' ? `${settled}%` : formula;
    default: {
      if (endsWithValue(formula)) {
        return `${settled}${key}`;
      }
      // Where a number is due, a minus is its sign.
      if (key === '-' && (last === undefined || last === '(' || last === '*' || last === '/')) {
        return `${formula}-`;
      }
      // Otherwise in place of the operator before it, if there's a value for it to follow.
      const base = formula.replace(/[-+*/]+$/, '');
      return isOperator(last) && endsWithValue(base) ? `${base}${key}` : formula;
    }
  }
}

/**
 * The formula as an amount when it is one already — a single number, to the cent, with nothing
 * left to work out — or null.
 */
export function formulaAmount(formula: string): string | null {
  return /^\d+(,\d{0,2})?$/.test(formula) ? parseMoneyInput(formula) : null;
}

/**
 * Works the formula out into a single number: without its sign, since an amount has none, and
 * rounded to the cent. Brackets left open close at the end. `%` is per cent, and after + or − it's
 * of what comes before: 200 − 15% is 170.
 */
export function evaluateFormula(formula: string): Evaluation {
  const closed = `${formula}${')'.repeat(Math.max(0, openBrackets(formula)))}`;
  const tokens = closed.match(/\d+(?:,\d*)?|[-+*/%()]/g) ?? [];
  let position = 0;

  // expression := term (('+' | '-') term)*
  const expression = (): Fraction => {
    let value = term().value;
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position++];
      const right = term();
      const amount = right.percent ? value.mul(right.value) : right.value;
      value = operator === '+' ? value.add(amount) : value.sub(amount);
    }
    return value;
  };
  // term := unary (('*' | '/') unary)* — a percentage only while it stands alone.
  const term = (): Operand => {
    let { value, percent } = unary();
    while (tokens[position] === '*' || tokens[position] === '/') {
      const operator = tokens[position++];
      const right = unary().value;
      value = operator === '*' ? value.mul(right) : divide(value, right);
      percent = false;
    }
    return { value, percent };
  };
  // unary := '-' unary | primary '%'?
  const unary = (): Operand => {
    if (tokens[position] === '-') {
      position++;
      const operand = unary();
      return { ...operand, value: operand.value.neg() };
    }
    const value = primary();
    if (tokens[position] === '%') {
      position++;
      return { value: value.div(100), percent: true };
    }
    return { value, percent: false };
  };
  // primary := number | '(' expression ')'
  const primary = (): Fraction => {
    const token = tokens[position++];
    if (token === '(') {
      const value = expression();
      if (tokens[position++] !== ')') {
        throw new FormulaError('incomplete');
      }
      return value;
    }
    if (token !== undefined && isDigit(token[0])) {
      const [whole, decimals = ''] = token.split(',');
      return new Fraction(BigInt(`${whole}${decimals}`), 10n ** BigInt(decimals.length));
    }
    throw new FormulaError('incomplete');
  };

  try {
    const value = expression();
    if (position < tokens.length) {
      throw new FormulaError('incomplete');
    }
    // The sign gone, then to the cent: half up, which without a sign is half away from zero, as
    // money rounds.
    const cents = value.abs().mul(100).round().n;
    if (cents >= MAX_CENTS) {
      throw new FormulaError('tooLarge');
    }
    const decimals = (cents % 100n).toString().padStart(2, '0').replace(/0+$/, '');
    return { formula: `${cents / 100n}${decimals ? `,${decimals}` : ''}` };
  } catch (error) {
    if (error instanceof FormulaError) {
      return { error: error.reason };
    }
    throw error;
  }
}

/**
 * The formula as the calculator shows it: × ÷ − for the operators, spaced from what they join (a
 * minus that makes a number negative stays on it), and whole numbers in groups of three.
 */
export function displayFormula(formula: string): string {
  return formula.replace(/\d+(?:,\d*)?|[-+*/]/g, (token, offset: number) => {
    if (isDigit(token[0])) {
      const [whole, ...decimals] = token.split(',');
      return [whole.replace(/\B(?=(\d{3})+$)/g, '\u202f'), ...decimals].join(',');
    }
    const previous = formula[offset - 1];
    if (token === '-' && (previous === undefined || previous === '(' || isOperator(previous))) {
      return '−';
    }
    // Kept on the line of what it follows, so a long formula wraps after an operator, not before.
    return `\u00a0${SIGNS[token as Operator]} `;
  });
}

const SIGNS: Record<Operator, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

// An amount has at most twelve digits before the point.
const MAX_CENTS = 10n ** 14n;

class FormulaError extends Error {
  constructor(readonly reason: CalculatorError) {
    super(reason);
  }
}

interface Operand {
  value: Fraction;
  // A percentage on its own ("15%"), which + and − take of what they add it to.
  percent: boolean;
}

// Said as a calculator says it, rather than as fraction.js throws it.
function divide(a: Fraction, b: Fraction): Fraction {
  if (b.n === 0n) {
    throw new FormulaError('divisionByZero');
  }
  return a.div(b);
}
