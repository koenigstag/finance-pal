import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity.js';

@Entity('groups')
export class Group {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  // source of truth for authorization is group_members.role === 'owner';
  // change only through GroupsService.transferOwnership(), never a raw UPDATE —
  // otherwise this column and group_members can drift apart
  @Column({ type: 'uuid', name: 'owner_id' })
  ownerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id' })
  owner!: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  // archiving instead of deleting; null = active
  @Column({ type: 'timestamptz', name: 'archived_at', nullable: true })
  archivedAt!: Date | null;
}
