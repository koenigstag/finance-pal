import { ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { Propagation, Transactional } from 'typeorm-transactional';
import * as argon2 from 'argon2';
import { RefreshToken, User } from '@ft/api-database';
import type { Env } from '../_core/config/env.schema';
import { hashToken, tokenMatchesHash, type RefreshTokenPayload } from './tokens.util';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Transactional()
  async register(email: string, password: string): Promise<AuthResult> {
    const existing = await this.users.findOneBy({ email });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    const user = await this.users.save(this.users.create({ email, passwordHash }));

    // Profile (display name, currency, etc.), the default group, and its starter
    // accounts/categories are no longer created here — see the onboarding module: register()
    // only establishes identity, onboarding is a separate authenticated flow so returning
    // users can complete it too when new fields are added, not just at signup.
    return this.issueTokens(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.users.findOneBy({ email });
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
      // Same message whether the email doesn't exist or the password is wrong —
      // distinguishing the two would let an attacker enumerate registered emails.
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueTokens(user);
  }

  @Transactional()
  async refresh(tokenValue: string): Promise<Omit<AuthResult, 'user'>> {
    // Signature and expiry first: a forged, tampered or expired token is turned away without a
    // database lookup. The row check below still decides: the signature proves the token was
    // issued by this API, the stored hash that it's the one issued for this row.
    const claims = await this.verifyRefreshToken(tokenValue);
    const token = claims && (await this.refreshTokens.findOneBy({ id: claims.jti }));

    if (!claims || !token || token.userId !== claims.sub || !tokenMatchesHash(tokenValue, token.tokenHash)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (token.revokedAt) {
      // This token was already rotated (or explicitly revoked) yet is being presented again —
      // treat the whole family as compromised. Runs in its own transaction so the revocation
      // survives the UnauthorizedException below rolling back the rest of this method.
      await this.revokeFamily(token.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // The JWT's own exp already covers this; the row's expiry stays authoritative in case the two
    // ever disagree (e.g. a TTL change between issuing and presenting a token).
    if (token.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.users.findOneBy({ id: token.userId });
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.refreshTokens.update(token.id, { revokedAt: new Date() });
    const { accessToken, refreshToken } = await this.issueTokens(user, token.familyId);
    return { accessToken, refreshToken };
  }

  /**
   * Swaps the password for a new one, having checked the current one, and hands back a fresh
   * token pair.
   *
   * Every refresh token the user had is revoked first — a password change is how someone locks
   * an intruder (or a device they no longer have) out, so nothing issued under the old password
   * may survive it. That includes the caller's own, hence the new pair: the device doing the
   * changing stays signed in, every other one is sent back to the login screen the moment its
   * access token expires.
   */
  @Transactional()
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<Omit<AuthResult, 'user'>> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, currentPassword))) {
      // The caller is authenticated and we know who they are, so there's no email to enumerate
      // here; 403 keeps a wrong password apart from the 401 an expired access token gets.
      throw new ForbiddenException('Current password is incorrect');
    }

    await this.users.update(user.id, { passwordHash: await argon2.hash(newPassword, ARGON2_OPTIONS) });
    await this.refreshTokens.update({ userId: user.id, revokedAt: IsNull() }, { revokedAt: new Date() });

    // Issued after the revocation above, so this pair isn't caught by it.
    const { accessToken, refreshToken } = await this.issueTokens(user);
    return { accessToken, refreshToken };
  }

  async logout(tokenValue: string): Promise<void> {
    // An invalid or already-expired token has nothing left to revoke.
    const claims = await this.verifyRefreshToken(tokenValue);
    if (!claims) {
      return;
    }

    const token = await this.refreshTokens.findOneBy({ id: claims.jti });
    if (token && !token.revokedAt && tokenMatchesHash(tokenValue, token.tokenHash)) {
      await this.refreshTokens.update(token.id, { revokedAt: new Date() });
    }
  }

  @Transactional({ propagation: Propagation.REQUIRES_NEW })
  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async issueTokens(user: User, familyId?: string): Promise<AuthResult> {
    // Access tokens use the JwtModule defaults: JWT_ACCESS_SECRET and JWT_ACCESS_TTL.
    const accessToken = await this.jwt.signAsync({ sub: user.id });

    const id = randomUUID();
    const ttlSeconds = this.config.get('JWT_REFRESH_TTL_SECONDS', { infer: true });
    const payload: RefreshTokenPayload = { sub: user.id, jti: id, fam: familyId ?? id };
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      expiresIn: ttlSeconds,
    });

    await this.refreshTokens.save(
      this.refreshTokens.create({
        id,
        userId: user.id,
        familyId: payload.fam,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      }),
    );

    return { user, accessToken, refreshToken };
  }

  // Null for anything that isn't a valid, unexpired refresh token signed with the refresh secret —
  // including an access token, which is signed with the other one.
  private async verifyRefreshToken(tokenValue: string): Promise<RefreshTokenPayload | null> {
    try {
      const claims = await this.jwt.verifyAsync<RefreshTokenPayload>(tokenValue, {
        secret: this.config.get('JWT_REFRESH_SECRET', { infer: true }),
      });
      return typeof claims.jti === 'string' && typeof claims.sub === 'string' && typeof claims.fam === 'string'
        ? claims
        : null;
    } catch {
      return null;
    }
  }
}
