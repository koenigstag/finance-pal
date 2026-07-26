import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupMember } from '@ft/api-database';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeEmitterService } from './realtime-emitter.service';

@Module({
  imports: [TypeOrmModule.forFeature([GroupMember])],
  providers: [RealtimeGateway, RealtimeEmitterService],
  exports: [RealtimeEmitterService],
})
export class RealtimeModule {}
