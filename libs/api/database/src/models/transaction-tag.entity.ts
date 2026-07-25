import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Transaction } from './transaction.entity.js';
import { Tag } from './tag.entity.js';

@Entity('transaction_tags')
export class TransactionTag {
  @PrimaryColumn({ type: 'uuid', name: 'transaction_id' })
  transactionId!: string;

  @ManyToOne(() => Transaction, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'transaction_id' })
  transaction!: Transaction;

  @PrimaryColumn({ type: 'uuid', name: 'tag_id' })
  tagId!: string;

  @ManyToOne(() => Tag, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tag_id' })
  tag!: Tag;
}
