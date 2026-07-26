import { Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { Server, Socket } from 'socket.io';
import { GroupMember } from '@ft/api-database';
import { withRlsUser } from '../_core/rls/with-rls-user';
import { RealtimeEmitterService } from './realtime-emitter.service';

interface AccessTokenPayload {
  sub: string;
}

/**
 * Auth happens here, in handleConnection, rather than via a Guard: Nest WS guards run per
 * @SubscribeMessage handler, not on the connection itself, and this gateway has no message
 * handlers to protect — every socket either authenticates at connect time or gets dropped.
 * Mirrors JwtAuthGuard's verification (same JwtService, same "one vague 401-equivalent" on any
 * failure) but reads the token from `handshake.auth.token` instead of an Authorization header,
 * since a long-lived socket connection has no per-message headers to carry it on.
 */
@WebSocketGateway({ cors: true })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(GroupMember) private readonly groupMembers: Repository<GroupMember>,
    private readonly emitter: RealtimeEmitterService,
  ) {}

  afterInit(server: Server): void {
    this.emitter.setServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.['token'] as string | undefined;
    if (!token) {
      client.disconnect(true);
      return;
    }

    let userId: string;
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      userId = payload.sub;
    } catch {
      client.disconnect(true);
      return;
    }

    client.data.userId = userId;
    await client.join(`user:${userId}`);

    // RLS-scoped, but only for the lifetime of this one query — never held open for the
    // connection's lifetime, unlike RlsContextInterceptor's per-HTTP-request transaction.
    const memberships = await withRlsUser(this.dataSource, userId, () =>
      this.groupMembers.find({ where: { userId } }),
    );
    if (memberships.length > 0) {
      await client.join(memberships.map((m) => `group:${m.groupId}`));
    }

    this.logger.debug(`Socket ${client.id} connected as user ${userId} (${memberships.length} group room(s))`);
  }
}
