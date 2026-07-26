import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Propagation, Transactional } from 'typeorm-transactional';
import * as argon2 from 'argon2';
import { RefreshToken, User } from '@ft/api-database';
import type { Env } from '../_core/config/env.schema';
import { OnboardingService } from '../onboarding/onboarding.service';
import { generateOpaqueToken, parseOpaqueToken, secretMatchesHash } from './tokens.util';

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
    private readonly onboarding: OnboardingService,
  ) {}

  @Transactional()
  async register(email: string, password: string): Promise<AuthResult> {
    const existing = await this.users.findOneBy({ email });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await argon2.hash(password, ARGON2_OPTIONS);
    const user = await this.users.save(this.users.create({ email, passwordHash }));

    await this.onboarding.seedNewUser(user);

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
    const parsed = parseOpaqueToken(tokenValue);
    const token = parsed && (await this.refreshTokens.findOneBy({ id: parsed.id }));

    if (!parsed || !token || !secretMatchesHash(parsed.secret, token.tokenHash)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (token.revokedAt) {
      // This token was already rotated (or explicitly revoked) yet is being presented again —
      // treat the whole family as compromised. Runs in its own transaction so the revocation
      // survives the UnauthorizedException below rolling back the rest of this method.
      await this.revokeFamily(token.familyId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

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

  async logout(tokenValue: string): Promise<void> {
    const parsed = parseOpaqueToken(tokenValue);
    if (!parsed) {
      return;
    }

    const token = await this.refreshTokens.findOneBy({ id: parsed.id });
    if (token && !token.revokedAt && secretMatchesHash(parsed.secret, token.tokenHash)) {
      await this.refreshTokens.update(token.id, { revokedAt: new Date() });
    }
  }

  @Transactional({ propagation: Propagation.REQUIRES_NEW })
  private async revokeFamily(familyId: string): Promise<void> {
    await this.refreshTokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  private async issueTokens(user: User, familyId?: string): Promise<AuthResult> {
    const accessToken = await this.jwt.signAsync({ sub: user.id });

    const opaque = generateOpaqueToken();
    await this.refreshTokens.save(
      this.refreshTokens.create({
        id: opaque.id,
        userId: user.id,
        familyId: familyId ?? opaque.id,
        tokenHash: opaque.hash,
        expiresAt: this.refreshExpiryDate(),
      }),
    );

    return { user, accessToken, refreshToken: opaque.value };
  }

  private refreshExpiryDate(): Date {
    const ttlSeconds = this.config.get('JWT_REFRESH_TTL_SECONDS', { infer: true });
    return new Date(Date.now() + ttlSeconds * 1000);
  }
}
