import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { GroupMember } from './group-member.entity.js';

// A one-time code an app connecting over OAuth trades for an API key, made when a member allows the
// app into a group. Only its hash is stored; redeem_oauth_code() is the one way to trade it.
@Entity('oauth_codes')
export class OauthCode {
  // sha256 of the code, hex.
  @PrimaryColumn({ type: 'text', name: 'code_hash' })
  codeHash!: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => GroupMember, { onDelete: 'CASCADE' })
  @JoinColumn([
    { name: 'group_id', referencedColumnName: 'groupId' },
    { name: 'user_id', referencedColumnName: 'userId' },
  ])
  member!: GroupMember;

  @Column({ type: 'text', name: 'client_id' })
  clientId!: string;

  @Column({ type: 'text', name: 'client_name' })
  clientName!: string;

  @Column({ type: 'text', name: 'redirect_uri' })
  redirectUri!: string;

  // base64url of the S256 digest of the app's code verifier.
  @Column({ type: 'text', name: 'code_challenge' })
  codeChallenge!: string;

  @Column({ type: 'text', array: true })
  scopes!: string[];

  @Column({ type: 'text', name: 'time_zone', nullable: true })
  timeZone!: string | null;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
