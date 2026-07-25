import {
  Check,
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
import { Account } from './account.entity.js';
import { Category } from './category.entity.js';
import { User } from './user.entity.js';
import { TransactionType } from './enums.js';

@Entity('transactions')
@Index('idx_transactions_group_date', ['groupId', 'date'], { where: 'deleted_at IS NULL' })
@Index('idx_transactions_account', ['accountId'], { where: 'deleted_at IS NULL' })
@Index('idx_transactions_category', ['categoryId'], { where: 'deleted_at IS NULL' })
@Check(
  'chk_transaction_sides',
  `(type = 'transfer' AND to_account_id IS NOT NULL AND category_id IS NULL) OR (type IN ('expense', 'income') AND to_account_id IS NULL)`,
)
@Check('chk_transaction_amount_positive', `amount > 0 AND (dest_amount IS NULL OR dest_amount > 0)`)
export class Transaction {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Group;

  @Column({ type: 'enum', enum: TransactionType, enumName: 'transaction_type' })
  type!: TransactionType;

  @Column({ type: 'timestamptz' })
  date!: Date;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'smallint', name: 'currency_id' })
  currencyId!: number;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_id' })
  currency!: Currency;

  // always set, regardless of transaction type
  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  // expense/income only
  @Column({ type: 'uuid', name: 'category_id', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category!: Category | null;

  // transfer only
  @Column({ type: 'uuid', name: 'to_account_id', nullable: true })
  toAccountId!: string | null;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'to_account_id' })
  toAccount!: Account | null;

  // transfer with currency conversion only
  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'dest_amount', nullable: true })
  destAmount!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

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
