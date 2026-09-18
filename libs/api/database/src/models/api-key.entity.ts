import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { GroupMember } from './group-member.entity.js';

// A key another app uses to work in one group as the member who made it. Only a hash of the key
// is stored; the key itself is shown once, when it's created.
@Entity('api_keys')
@Index('idx_api_keys_member', ['groupId', 'userId'])
export class ApiKey {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  // The key hangs off its owner's membership, not off the user and the group separately: leaving
  // or being removed from the group deletes it, and there's no group without members to outlive.
  @ManyToOne(() => GroupMember, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'group_id', referencedColumnName: 'groupId' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member!: GroupMember;

  @Column({ type: 'text' })
  name!: string;

  // sha256 of the whole key, hex.
  @Column({ type: 'text', name: 'token_hash', unique: true })
  tokenHash!: string;

  // The key's first characters, kept in the clear to tell keys apart in a list.
  @Column({ type: 'text', name: 'token_prefix' })
  tokenPrefix!: string;

  // "<resource>:<access>" strings, validated by the API against its list of scopes.
  @Column({ type: 'text', array: true })
  scopes!: string[];

  // null: until deleted.
  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  // Updated at most once a minute, by authenticate_api_key().
  @Column({ type: 'timestamptz', name: 'last_used_at', nullable: true })
  lastUsedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
