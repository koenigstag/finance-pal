import { generateApiKey, hashApiKey, isWellFormedApiKey } from './api-key-token';

describe('generateApiKey', () => {
  it('makes well-formed keys, never the same one twice', () => {
    const keys = Array.from({ length: 50 }, () => generateApiKey().token);
    expect(keys.every(isWellFormedApiKey)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('stores only the hash, and shows only the start', () => {
    const { token, tokenHash, tokenPrefix } = generateApiKey();
    expect(tokenHash).toBe(hashApiKey(token));
    expect(tokenHash).not.toContain(token.slice(4));
    expect(tokenPrefix).toBe(token.slice(0, 10));
  });
});

describe('isWellFormedApiKey', () => {
  it.each([
    ['an access token', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl'],
    ['another prefix', `sk_${'a'.repeat(40)}`],
    ['a short key', `fpk_${'a'.repeat(39)}`],
    ['a long key', `fpk_${'a'.repeat(41)}`],
    ['a character outside base62', `fpk_${'a'.repeat(39)}-`],
  ])('refuses %s', (_label, value) => {
    expect(isWellFormedApiKey(value)).toBe(false);
  });
});
