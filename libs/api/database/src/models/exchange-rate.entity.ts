import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The last rates fetched for one base currency — a cache, not a record. Each refresh overwrites
 * the row, so there is one per base rather than one per day.
 *
 * It lives in the database instead of in memory so that a restart, or both providers being
 * unreachable at once, still leaves something to convert with: a rate from yesterday beats a
 * total that refuses to render.
 */
@Entity('exchange_rates')
export class ExchangeRate {
  @PrimaryColumn({ type: 'text', name: 'base_code' })
  baseCode!: string;

  // ISO code → how much of the base currency one unit of it buys, as a decimal string:
  // { "USD": "44.66" } against UAH. Strings, like every other amount here, so no float rounding
  // reaches a converted total. The base itself is present at "1".
  @Column({ type: 'jsonb' })
  rates!: Record<string, string>;

  // The day the provider published these (YYYY-MM-DD), which trails `fetchedAt` by design.
  @Column({ type: 'date', name: 'published_on' })
  publishedOn!: string;

  // `name` of the RateProvider that answered — the two disagree slightly, so a rate is only
  // explainable next to the provider that quoted it.
  @Column({ type: 'text' })
  provider!: string;

  @Column({ type: 'timestamptz', name: 'fetched_at' })
  fetchedAt!: Date;
}
