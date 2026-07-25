import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Group } from './group.entity.js';
import { Currency } from './currency.entity.js';
import { User } from './user.entity.js';
import { AccountType } from './enums.js';

@Entity('accounts')
@Index('idx_accounts_group', ['groupId'], { where: 'deleted_at IS NULL' })
export class Account {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Group;

  @Column({ type: 'enum', enum: AccountType, enumName: 'account_type', default: AccountType.REGULAR })
  type!: AccountType;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'smallint', name: 'currency_id' })
  currencyId!: number;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_id' })
  currency!: Currency;

  @Column({ type: 'boolean', name: 'is_favourite', default: false })
  isFavourite!: boolean;

  @Column({ type: 'text', nullable: true })
  icon!: string | null;

  @Column({ type: 'text', nullable: true })
  color!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'boolean', name: 'is_included_in_balance', default: true })
  isIncludedInBalance!: boolean;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder!: number;

  @Column({ type: 'boolean', default: false })
  archived!: boolean;

  @Column({ type: 'timestamptz', name: 'archived_at', nullable: true })
  archivedAt!: Date | null;

  // maintained by a DB trigger on `transactions`, not application code — see
  // "Баланс счёта: cached_balance вместо full-scan вьюхи" in 01-architecture-decisions.md
  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'cached_balance', default: '0' })
  cachedBalance!: string;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator!: User;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt!: Date | null;
}
