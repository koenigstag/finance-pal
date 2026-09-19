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
// An estimate from the balance (worked out before its date) may come to nothing for now.
@Check(
  'chk_transaction_amount_positive',
  `(amount > 0 OR (amount = 0 AND percentage_as_of IS NOT NULL AND percentage_as_of < date)) AND (dest_amount IS NULL OR dest_amount > 0)`,
)
@Check('chk_transaction_percentage', `percentage IS NULL OR (percentage > 0 AND percentage <= 100)`)
@Check('chk_transaction_percentage_base', `percentage_base IS NULL OR (percentage IS NOT NULL AND percentage_base > 0)`)
@Check('chk_transaction_round_balance_to', `round_balance_to IS NULL OR (round_balance_to IN (1, 10, 100, 1000) AND percentage IS NULL)`)
@Check(
  'chk_transaction_percentage_as_of',
  `percentage_as_of IS NULL OR (percentage IS NOT NULL AND percentage_base IS NULL) OR round_balance_to IS NOT NULL`,
)
// Only amounts from a balance that are still estimates, for the scheduler to find.
@Index('idx_transactions_percentage_pending', ['date'], { where: 'percentage_as_of < date AND deleted_at IS NULL' })
// Only a transfer converts between currencies.
@Check('chk_transaction_dest_amount_as_of', `dest_amount_as_of IS NULL OR to_account_id IS NOT NULL`)
// Only received amounts converted at a rate that are still estimates, for the scheduler to find.
@Index('idx_transactions_dest_rate_pending', ['date'], { where: 'dest_amount_as_of < date AND deleted_at IS NULL' })
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

  // Set when destAmount was worked out from an exchange rate rather than typed: when it last was.
  // Before `date`, it's an estimate at the latest rate, worked out again until the date comes and
  // then a last time, at that day's rate, when it stays. Null for an amount the user typed, which
  // no rate ever overrides. Null destAmount beside it means the amount came to nothing for now.
  @Column({ type: 'timestamptz', name: 'dest_amount_as_of', nullable: true })
  destAmountAsOf!: Date | null;

  // the percentage the amount was worked out as, when it was one: of percentage_base if set,
  // otherwise of the account's balance
  @Column({ type: 'numeric', precision: 7, scale: 4, nullable: true })
  percentage!: string | null;

  // only ever beside a percentage
  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'percentage_base', nullable: true })
  percentageBase!: string | null;

  // "round the balance": the amount is whatever leaves the account's balance on a multiple of this
  // (1, 10, 100 or 1000) once the transaction goes through; never beside a percentage
  @Column({ type: 'smallint', name: 'round_balance_to', nullable: true })
  roundBalanceTo!: number | null;

  // an amount from the balance (a percentage of it with no base, or a rounding of it): when it was
  // last worked out. Before `date`, it's an estimate that follows the account until the date comes,
  // when it's worked out a last time. Named before rounding came along
  @Column({ type: 'timestamptz', name: 'percentage_as_of', nullable: true })
  percentageAsOf!: Date | null;

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
