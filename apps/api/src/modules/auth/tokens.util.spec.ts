import { JwtService } from '@nestjs/jwt';
import { hashToken, tokenMatchesHash } from './tokens.util';

const accessSecret = 'a'.repeat(64);
const refreshSecret = 'r'.repeat(64);

describe('refresh token hashing', () => {
  it('matches only the exact token', () => {
    const hash = hashToken('header.payload.signature');
    expect(tokenMatchesHash('header.payload.signature', hash)).toBe(true);
    expect(tokenMatchesHash('header.payload.signaturf', hash)).toBe(false);
    expect(tokenMatchesHash('', hash)).toBe(false);
  });

  it('never stores the token itself', () => {
    expect(hashToken('header.payload.signature')).not.toContain('payload');
  });
});

// The reason for two secrets: each kind of token only verifies with its own key.
describe('separate access and refresh secrets', () => {
  const jwt = new JwtService({ secret: accessSecret });

  it('rejects a refresh token presented as an access token', async () => {
    const refreshToken = await jwt.signAsync({ sub: 'u1', jti: 't1', fam: 't1' }, { secret: refreshSecret });
    await expect(jwt.verifyAsync(refreshToken)).rejects.toThrow();
    await expect(jwt.verifyAsync(refreshToken, { secret: refreshSecret })).resolves.toMatchObject({ jti: 't1' });
  });

  it('rejects an access token presented as a refresh token', async () => {
    const accessToken = await jwt.signAsync({ sub: 'u1' });
    await expect(jwt.verifyAsync(accessToken, { secret: refreshSecret })).rejects.toThrow();
  });
});
