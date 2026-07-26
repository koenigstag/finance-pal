import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken, User } from '@ft/api-database';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// JwtService comes from AuthnModule's global JwtModule registration — signing here and
// verification in JwtAuthGuard must share one configured secret, not two registrations
// that could drift apart.
@Module({
  imports: [TypeOrmModule.forFeature([User, RefreshToken])],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
