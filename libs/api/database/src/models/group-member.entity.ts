import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Group } from './group.entity.js';
import { User } from './user.entity.js';
import { MemberRole } from './enums.js';

@Entity('group_members')
export class GroupMember {
  @PrimaryColumn({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Group;

  @Index('idx_group_members_user')
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: MemberRole, enumName: 'member_role', default: MemberRole.MEMBER })
  role!: MemberRole;

  @CreateDateColumn({ type: 'timestamptz', name: 'joined_at' })
  joinedAt!: Date;
}
