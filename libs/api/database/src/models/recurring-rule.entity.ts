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
import { RecurrenceUnit, TransactionType } from './enums.js';

@Entity('recurring_rules')
@Index('idx_recurring_group', ['groupId'], { where: 'deleted_at IS NULL' })
@Check(
  'chk_recurring_sides',
  `(type = 'transfer' AND to_account_id IS NOT NULL AND category_id IS NULL) OR (type IN ('expense', 'income') AND to_account_id IS NULL)`,
)
@Check('chk_recurring_amount_positive', `amount > 0`)
@Check('chk_recurring_subcategory', `subcategory_id IS NULL OR category_id IS NOT NULL`)
@Check('chk_recurring_percentage', `percentage IS NULL OR (percentage > 0 AND percentage <= 100)`)
@Check('chk_recurring_percentage_base', `percentage_base IS NULL OR (percentage IS NOT NULL AND percentage_base > 0)`)
@Check('chk_recurring_round_balance_to', `round_balance_to IS NULL OR (round_balance_to IN (1, 10, 100, 1000) AND percentage IS NULL)`)
export class RecurringRule {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Group;

  // template for the transaction created on each run
  @Column({ type: 'enum', enum: TransactionType, enumName: 'transaction_type' })
  type!: TransactionType;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount!: string;

  @Column({ type: 'smallint', name: 'currency_id' })
  currencyId!: number;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'currency_id' })
  currency!: Currency;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({ name: 'account_id' })
  account!: Account;

  @Column({ type: 'uuid', name: 'category_id', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category!: Category | null;

  // as on a transaction: optional, and only ever one of category_id's own subcategories
  @Column({ type: 'uuid', name: 'subcategory_id', nullable: true })
  subcategoryId!: string | null;

  @ManyToOne(() => Category, { nullable: true })
  @JoinColumn({ name: 'subcategory_id' })
  subcategory!: Category | null;

  @Column({ type: 'uuid', name: 'to_account_id', nullable: true })
  toAccountId!: string | null;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'to_account_id' })
  toAccount!: Account | null;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  // as on a transaction: each occurrence's amount worked out as this percentage, of percentage_base
  // if set, otherwise of the account's balance on the occurrence's date. `amount` is then what it
  // came to when the series was saved, and stands in for a planned estimate that comes to nothing
  // (for a rounding too)
  @Column({ type: 'numeric', precision: 7, scale: 4, nullable: true })
  percentage!: string | null;

  @Column({ type: 'numeric', precision: 14, scale: 2, name: 'percentage_base', nullable: true })
  percentageBase!: string | null;

  // as on a transaction, instead of a percentage: each occurrence's amount is whatever leaves the
  // account's balance on a multiple of this on the occurrence's date
  @Column({ type: 'smallint', name: 'round_balance_to', nullable: true })
  roundBalanceTo!: number | null;

  @Column({ type: 'enum', enum: RecurrenceUnit, enumName: 'recurrence_unit', name: 'interval_unit' })
  intervalUnit!: RecurrenceUnit;

  // "every N units"
  @Column({ type: 'int', name: 'interval_value', default: 1 })
  intervalValue!: number;

  // anchor of the series: occurrence k = startsAt + k·interval, never advanced from the last one
  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  // first occurrence not yet materialized as a transaction (the scheduler's frontier)
  @Column({ type: 'timestamptz', name: 'next_run_date' })
  nextRunDate!: Date;

  // null = no reminder
  @Column({ type: 'int', name: 'reminder_days_before', nullable: true })
  reminderDaysBefore!: number | null;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  // IANA zone the schedule is evaluated in — "every 1st of the month" is ambiguous without one
  @Column({ type: 'text', default: 'UTC' })
  timezone!: string;

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
