import { describe, expect, it } from 'vitest';
import { displayNameFromEmail } from './display-name';

describe('displayNameFromEmail', () => {
  it.each([
    ['koenigstag@gmail.com', 'Koenigstag'],
    ['john.doe@example.com', 'John Doe'],
    ['mary_ann-smith@example.com', 'Mary Ann Smith'],
    ['anna1987@example.com', 'Anna'],
    ['alex+bank@example.com', 'Alex'],
    ['иван.петров@пример.рф', 'Иван Петров'],
  ])('%s → %s', (email, expected) => {
    expect(displayNameFromEmail(email, 'en')).toBe(expected);
  });

  it('is empty when nothing name-like is left', () => {
    expect(displayNameFromEmail('12345@example.com', 'en')).toBe('');
    expect(displayNameFromEmail(undefined, 'en')).toBe('');
  });

  it('fits the profile name limit', () => {
    expect(displayNameFromEmail(`${'a'.repeat(100)}@example.com`, 'en')).toHaveLength(80);
  });
});
