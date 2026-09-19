import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';

// A note somebody schedules for the group: their own words, a moment they choose, and — once the
// moment comes and the scheduler has handed it to the push services — the time it went out.
@Entity('scheduled_notifications')
@Index('idx_scheduled_notifications_group', ['groupId'])
// The scheduler's query, and only its rows: one partial index over what is still to come, which
// stays small however many have already gone out.
@Index('idx_scheduled_notifications_due', ['sendAt'], { where: 'sent_at IS NULL' })
export class ScheduledNotification {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Group;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'timestamptz', name: 'send_at' })
  sendAt!: Date;

  // The IANA zone it was picked in, so the app can show back the time that was chosen rather than
  // the same instant read somewhere else. The scheduler never needs it: send_at is the instant.
  @Column({ type: 'text' })
  timezone!: string;

  // null while it is still to come. Set by the scheduler as it claims the row, which is also what
  // keeps two instances — or one tick overrunning the next — from sending it twice.
  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator!: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
