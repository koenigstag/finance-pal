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
import { RecurringRule } from './recurring-rule.entity.js';
import { TransactionType } from './enums.js';

@Entity('transactions')
@Index('idx_transactions_group_date', ['groupId', 'date'], { where: 'deleted_at IS NULL' })
@Index('uq_transactions_occurrence', ['recurringRuleId', 'recurrenceDate'], {
  unique: true,
  where: 'recurring_rule_id IS NOT NULL',
})
@Index('idx_transactions_account', ['accountId'], { where: 'deleted_at IS NULL' })
@Index('idx_transactions_category', ['categoryId'], { where: 'deleted_at IS NULL' })
@Index('idx_transactions_subcategory', ['subcategoryId'], { where: 'deleted_at IS NULL' })
@Check(
  'chk_transaction_sides',
  `(type = 'transfer' AND to_account_id IS NOT NULL AND category_id IS NULL) OR (type IN ('expense', 'income') AND to_account_id IS NULL)`,
)
@Check('chk_transaction_subcategory', `subcategory_id IS NULL OR category_id IS NOT NULL`)
@Check('chk_transaction_amount_positive', `amount > 0 AND (dest_amount IS NULL OR dest_amount > 0)`)
@Check('chk_transaction_percentage', `percentage IS NULL OR (percentage > 0 AND percentage <= 100)`)
@Check('chk_transaction_percentage_base', `percentage_base IS NULL OR (percentage IS NOT NULL AND percentage_base > 0)`)
// Soft-deleted rows included: a deleted transaction keeps its key, so a repeat can't bring it back.
@Index('uq_transactions_idempotency_key', ['groupId', 'idempotencyKey'], {
  unique: true,
  where: 'idempotency_key IS NOT NULL',
})
@Check('chk_transaction_idempotency', `(idempotency_key IS NULL) = (idempotency_fingerprint IS NULL)`)
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

  // expense/income only; always a top-level category, a subcategory goes in subcategory_id
  @Column({ type: 'uuid', name: 'category_id', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category!: Category | null;

  // optional, and only ever one of category_id's own subcategories
  @Column({ type: 'uuid', name: 'subcategory_id', nullable: true })
  subcategoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'subcategory_id' })
  subcategory!: Category | null;

  // transfer only
  @Column({ type: 'uuid', name: 'to_account_id', nullable: true })
  toAccountId!: string | null;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'to_account_id' })
  toAccount!: Account | null;

  // transfer with currency conversion only
  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'dest_amount', nullable: true })
  destAmount!: string | null;

  // the percentage the amount was worked out as, when it was one: of percentage_base if set,
  // otherwise of the account's balance
  @Column({ type: 'numeric', precision: 7, scale: 4, nullable: true })
  percentage!: string | null;

  // only ever beside a percentage
  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'percentage_base', nullable: true })
  percentageBase!: string | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  // set only on occurrences materialized from a recurring rule
  @Column({ type: 'uuid', name: 'recurring_rule_id', nullable: true })
  recurringRuleId!: string | null;

  @ManyToOne(() => RecurringRule, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recurring_rule_id' })
  recurringRule!: RecurringRule | null;

  // the occurrence's scheduled date — unlike `date`, never changed by editing the row
  @Column({ type: 'timestamptz', name: 'recurrence_date', nullable: true })
  recurrenceDate!: Date | null;

  // the user edited this occurrence directly, so regenerating the series must leave it alone
  @Column({ type: 'boolean', name: 'is_customized', default: false })
  isCustomized!: boolean;

  // Set on transactions the external API recorded for a request with an idempotency key: the
  // key's sha256, and one of what the request asked for. A repeat of the request finds this row
  // instead of recording the money again.
  @Column({ type: 'text', name: 'idempotency_key', nullable: true })
  idempotencyKey!: string | null;

  @Column({ type: 'text', name: 'idempotency_fingerprint', nullable: true })
  idempotencyFingerprint!: string | null;

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
