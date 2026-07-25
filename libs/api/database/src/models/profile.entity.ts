import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity.js';
import { Currency } from './currency.entity.js';

@Entity('profiles')
export class Profile {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id' })
  user!: User;

  @Column({ type: 'text' })
  email!: string;

  // fixed vs. the source schema: main_currency_id was `int` there with no FK,
  // while currencies.id is `smallint` — matched here and enforced as a real FK
  @Column({ type: 'smallint', name: 'main_currency_id', default: 1 })
  mainCurrencyId!: number;

  @ManyToOne(() => Currency)
  @JoinColumn({ name: 'main_currency_id' })
  mainCurrency!: Currency;

  @Column({ type: 'text', default: 'en' })
  language!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
