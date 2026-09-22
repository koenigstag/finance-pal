import { categoryByRules, type RuleCategoryLike, type RuleLike } from './category-by-rules';

const category = (id: string, extra: Partial<RuleCategoryLike> = {}): RuleCategoryLike => ({
  id,
  type: 'expense',
  parentId: null,
  archived: false,
  ...extra,
});

let clock = 0;
const rule = (pattern: string, categoryId: string): RuleLike => ({ pattern, categoryId, createdAt: new Date(++clock) });

const transport = category('transport');
const taxi = category('taxi', { parentId: 'transport' });
const food = category('food');
const groceries = category('groceries');
const salary = category('salary', { type: 'income' });
const categories = [transport, taxi, food, groceries, salary];

const file = (rules: RuleLike[], name: string, type = 'expense', within = categories) => categoryByRules(rules, within, type, name);

describe('categoryByRules', () => {
  it('files under the rule whose text is in the name, whatever the case', () => {
    const rules = [rule('Uber', 'taxi'), rule('Uklon', 'taxi')];
    expect(file(rules, 'UKLON')).toEqual({ categoryId: 'transport', subcategoryId: 'taxi' });
    expect(file(rules, 'WFP.UKLON.UA')).toEqual({ categoryId: 'transport', subcategoryId: 'taxi' });
    expect(file(rules, 'Uber *736')).toEqual({ categoryId: 'transport', subcategoryId: 'taxi' });
  });

  it('files a top-level category as the category alone', () => {
    expect(file([rule('АТБ', 'groceries')], 'АТБ')).toEqual({ categoryId: 'groceries', subcategoryId: null });
  });

  it("doesn't mind spacing, or an i typed in Latin rather than Cyrillic", () => {
    // The rule is typed with a Cyrillic і; the bank prints a Latin i.
    expect(file([rule('Сільпо', 'groceries')], 'Сiльпо')).toEqual({ categoryId: 'groceries', subcategoryId: null });
    expect(file([rule('  Uber   Eats ', 'food')], 'UBER EATS')).toEqual({ categoryId: 'food', subcategoryId: null });
  });

  it('lets the longest text win, and the oldest rule between equals', () => {
    const rules = [rule('Uber', 'taxi'), rule('Uber Eats', 'food')];
    expect(file(rules, 'Uber Eats Kyiv')).toEqual({ categoryId: 'food', subcategoryId: null });
    expect(file([rule('Silpo', 'groceries'), rule('silpo', 'food')], 'SILPO')).toEqual({ categoryId: 'groceries', subcategoryId: null });
  });

  it("only files a transaction of its category's type", () => {
    expect(file([rule('Uber', 'taxi')], 'Uber', 'income')).toBeNull();
    expect(file([rule('Заробiтна', 'salary')], 'Заробiтна плата', 'income')).toEqual({ categoryId: 'salary', subcategoryId: null });
  });

  it('passes over archived categories, and subcategories of one, for a rule that still fits', () => {
    const archivedTaxi = [transport, { ...taxi, archived: true }, food];
    expect(file([rule('Uber', 'taxi'), rule('Ub', 'food')], 'Uber', 'expense', archivedTaxi)).toEqual({
      categoryId: 'food',
      subcategoryId: null,
    });
    expect(file([rule('Uber', 'taxi')], 'Uber', 'expense', [{ ...transport, archived: true }, taxi])).toBeNull();
    // A category that's gone.
    expect(file([rule('Uber', 'deleted')], 'Uber')).toBeNull();
  });

  it('files nothing when no rule fits', () => {
    expect(file([rule('Uber', 'taxi')], 'Bolt')).toBeNull();
    expect(file([], 'Bolt')).toBeNull();
  });
});
