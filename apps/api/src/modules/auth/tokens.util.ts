import { createHash, timingSafeEqual } from 'crypto';

// Claims of a refresh token. Signed with JWT_REFRESH_SECRET — a different key from access tokens,
// so neither kind can be passed off as the other.
export interface RefreshTokenPayload {
  // The user the token belongs to.
  sub: string;
  // The refresh_tokens row: rotation and revocation state live there, not in the token.
  jti: string;
  // The rotation chain; reusing an already-rotated token revokes the whole family.
  fam: string;
}

/**
 * The stored form of a refresh token. Only this digest is kept, so a database leak yields nothing
 * that can be presented to /auth/refresh, even to someone who also has the signing secret.
 */
export function hashToken(token: string): string {
  // A signed token carries 256+ bits of unguessable material — a fast digest is the right tool
  // here; slow password hashing (argon2) only matters for low-entropy human secrets.
  return createHash('sha256').update(token).digest('hex');
}

export function tokenMatchesHash(token: string, hash: string): boolean {
  const actual = Buffer.from(hashToken(token));
  const expected = Buffer.from(hash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
