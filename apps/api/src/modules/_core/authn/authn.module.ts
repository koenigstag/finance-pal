import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.schema';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';

// Authentication (who the caller is), as opposed to authorization (what they may do), which
// lives in the CASL ability layer. JwtModule is registered global so both this guard's
// verification and AuthService's token signing share one configured instance.
//
// Two global guards, each owning one kind of credential: every route takes exactly one of them,
// an API key on the external API's routes and an access token everywhere else.
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) },
      }),
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ApiKeyAuthGuard },
  ],
})
export class AuthnModule {}
