import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { Account } from './account.entity.js';

@Entity('account_targets')
export class AccountTarget {
  @PrimaryColumn({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @OneToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'limit_amount', nullable: true })
  limitAmount!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'goal_amount', nullable: true })
  goalAmount!: string | null;
}
