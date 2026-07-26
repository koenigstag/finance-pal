import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'crypto';

// Opaque refresh tokens are "<row id>.<secret>": the id gives O(1) lookup by primary key,
// the secret is what actually proves possession — only its hash is ever stored.
export interface OpaqueToken {
  id: string;
  secret: string;
  hash: string;
  value: string;
}

export function generateOpaqueToken(): OpaqueToken {
  const id = randomUUID();
  const secret = randomBytes(32).toString('hex');
  const hash = hashSecret(secret);
  return { id, secret, hash, value: `${id}.${secret}` };
}

export function hashSecret(secret: string): string {
  // Random 256-bit secrets don't need a slow password hash (argon2) — the entropy alone
  // defeats brute force, so a fast digest is the correct and standard choice here.
  return createHash('sha256').update(secret).digest('hex');
}

export function parseOpaqueToken(value: string): { id: string; secret: string } | null {
  const separatorIndex = value.indexOf('.');
  if (separatorIndex === -1) {
    return null;
  }
  return { id: value.slice(0, separatorIndex), secret: value.slice(separatorIndex + 1) };
}

export function secretMatchesHash(secret: string, hash: string): boolean {
  const actual = Buffer.from(hashSecret(secret));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
