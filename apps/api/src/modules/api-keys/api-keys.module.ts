import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

// Managing API keys. Authenticating with them is _core/authn's ApiKeyAuthGuard, and what they
// open is the external module.
@Module({
  imports: [TypeOrmModule.forFeature([ApiKey]), AuthzModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
})
export class ApiKeysModule {}
