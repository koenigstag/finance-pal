import { createHash, randomInt } from 'node:crypto';

// A key reads "fpk_" and 40 base62 characters. The prefix makes a Finance Pal key recognizable at
// a glance, and to secret scanners; base62 keeps it one word, so a double-click selects all of it;
// 40 random characters carry about 238 bits.
const PREFIX = 'fpk_';
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const RANDOM_LENGTH = 40;
const KEY_PATTERN = /^fpk_[0-9A-Za-z]{40}$/;
// Kept in the clear to tell keys apart in a list: the prefix and six characters, which still
// leaves 34 unknown ones.
const VISIBLE_LENGTH = PREFIX.length + 6;

export interface NewApiKey {
  // Handed to the person once, never stored.
  token: string;
  tokenHash: string;
  tokenPrefix: string;
}

export function generateApiKey(): NewApiKey {
  let random = '';
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    // randomInt draws without modulo bias, so every character is equally likely.
    random += ALPHABET[randomInt(ALPHABET.length)];
  }
  const token = PREFIX + random;
  return { token, tokenHash: hashApiKey(token), tokenPrefix: token.slice(0, VISIBLE_LENGTH) };
}

/**
 * The stored form of a key: a leaked table holds nothing that works as a key. A fast digest is the
 * right tool, as for refresh tokens — 238 random bits can't be searched, so a slow password hash
 * would only cost every request time.
 */
export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Something that can't be a key is turned away without a database lookup.
export function isWellFormedApiKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}
