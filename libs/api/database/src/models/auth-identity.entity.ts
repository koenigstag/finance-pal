import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { User } from './user.entity.js';

@Entity('auth_identities')
@Unique('uq_auth_identities_provider_user', ['provider', 'providerUserId'])
export class AuthIdentity {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Index('idx_auth_identities_user')
  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // 'google' | 'apple' | ... kept as free text — provider list isn't fixed yet
  @Column({ type: 'text' })
  provider!: string;

  @Column({ type: 'text', name: 'provider_user_id' })
  providerUserId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
