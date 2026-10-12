import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OauthCode } from '@ft/api-database';
import { AuthzModule } from '../_core/authz/authz.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { OauthConsentController } from './oauth-consent.controller';
import { OauthProtocolController } from './oauth-protocol.controller';
import { OauthService } from './oauth.service';
import { OauthSettings } from './oauth-settings';

// OAuth sign-in for apps reaching the MCP endpoint. What the sign-in hands out is an API key, so
// what it opens is the external module's, and the key is managed with the group's others.
@Module({
  imports: [TypeOrmModule.forFeature([OauthCode]), AuthzModule, ApiKeysModule],
  controllers: [OauthProtocolController, OauthConsentController],
  providers: [OauthService, OauthSettings],
  // To the MCP endpoint, whose 401 says where to sign in.
  exports: [OauthSettings],
})
export class OauthModule {}
