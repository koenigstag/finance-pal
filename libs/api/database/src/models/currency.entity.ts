import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('currencies')
export class Currency {
  @PrimaryColumn({ type: 'smallint' })
  id!: number;

  @Column({ type: 'text', unique: true })
  code!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  symbol!: string | null;
}
