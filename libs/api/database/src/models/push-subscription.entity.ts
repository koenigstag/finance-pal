import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.js';

// One browser on one device, registered with its push service to be notified while the app is
// closed. A person has as many of these as they have devices; signing out on one deletes that one.
//
// The keys are the device's own: every payload is encrypted to them, so what is stored here can
// address a device but can't read anything sent to it.
@Entity('push_subscriptions')
@Index('idx_push_subscriptions_user', ['userId'])
export class PushSubscription {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // The push service's URL for this device, and the closest thing it has to an identity: unique,
  // so a device registering again replaces its row instead of adding a second one.
  @Column({ type: 'text', unique: true })
  endpoint!: string;

  // base64url, as the browser handed them over.
  @Column({ type: 'text' })
  p256dh!: string;

  @Column({ type: 'text' })
  auth!: string;

  // PUSH_TOPICS values, validated by the API against its list. Empty is allowed: a device that
  // has been quietened keeps its registration, and its browser permission with it.
  @Column({ type: 'text', array: true })
  topics!: string[];

  // Only to tell devices apart; never matched on.
  @Column({ type: 'text', name: 'user_agent', nullable: true })
  userAgent!: string | null;

  // When a push service last accepted a notification for this device — not when one was read.
  @Column({ type: 'timestamptz', name: 'last_notified_at', nullable: true })
  lastNotifiedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
