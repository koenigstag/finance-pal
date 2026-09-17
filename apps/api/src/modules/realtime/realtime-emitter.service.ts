import { Injectable } from '@nestjs/common';
import { runOnTransactionCommit } from 'typeorm-transactional';
import type { Server } from 'socket.io';
import { LEDGER_CHANGED_EVENT, type RealtimeEvent } from '@ft/shared-contracts';

/**
 * The one thing ledger/group services know about realtime — they call these three methods and
 * never touch Socket.io directly. Every method defers its actual work to
 * `runOnTransactionCommit()`, so a rollback (e.g. a later validation failure in the same request)
 * never results in a notification for data that was never persisted. Because these methods are
 * called from services that already run inside `RlsContextInterceptor`'s outer transaction (via
 * `@Transactional()`'s default REQUIRED propagation joining that same transaction, not opening a
 * new one), the commit hook fires exactly once, when the whole HTTP request's transaction
 * actually commits — see with-rls-user.ts / rls-context.interceptor.ts for the transaction this
 * rides on.
 */
@Injectable()
export class RealtimeEmitterService {
  private server: Server | null = null;

  setServer(server: Server): void {
    this.server = server;
  }

  emitToGroup(groupId: string, event: RealtimeEvent): void {
    runOnTransactionCommit(() => this.emitToGroupNow(groupId, event));
  }

  // For callers outside a typeorm-transactional context — the recurring scheduler runs its own
  // QueryRunner transactions, where runOnTransactionCommit has no hook to attach to. Only call
  // this after the caller's own commit has succeeded.
  emitToGroupNow(groupId: string, event: RealtimeEvent): void {
    this.server?.to(`group:${groupId}`).emit(LEDGER_CHANGED_EVENT, event);
  }

  // Makes an already-connected user's sockets start receiving group:<groupId> events without
  // requiring them to reconnect — used when a membership grant happens mid-session.
  joinUserToGroup(userId: string, groupId: string): void {
    runOnTransactionCommit(() => {
      this.server?.in(`user:${userId}`).socketsJoin(`group:${groupId}`);
    });
  }

  removeUserFromGroup(userId: string, groupId: string): void {
    runOnTransactionCommit(() => {
      this.server?.in(`user:${userId}`).socketsLeave(`group:${groupId}`);
    });
  }
}
