import { describe, expect, it } from 'vitest';
import { patternTaken, type CategoryRule } from './queries';

const rule = (id: string, pattern: string): CategoryRule => ({
  id,
  groupId: 'g',
  pattern,
  categoryId: 'taxi',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('patternTaken', () => {
  const rules = [rule('uklon', 'Uklon'), rule('uber', 'Uber')];

  it('finds a text another rule has, whatever the case or the spaces around it', () => {
    expect(patternTaken(rules, 'uklon')).toBe(true);
    expect(patternTaken(rules, '  UBER ')).toBe(true);
    expect(patternTaken(rules, 'Bolt')).toBe(false);
    // A longer text is a rule of its own: "Uber Eats" wins over "Uber" where both fit.
    expect(patternTaken(rules, 'Uber Eats')).toBe(false);
  });

  it("doesn't count the rule being changed", () => {
    expect(patternTaken(rules, 'UKLON', 'uklon')).toBe(false);
    expect(patternTaken(rules, 'Uber', 'uklon')).toBe(true);
  });
});
