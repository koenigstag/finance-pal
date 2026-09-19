import type { EntityManager } from 'typeorm';
import type { RecurringRule } from '@ft/api-database';
import { materializeOccurrences, nextOccurrence, regenerateOccurrences } from './occurrence-materializer';

interface Occurrence {
  recurrenceDate: Date;
  date: Date;
  deleted: boolean;
  customized: boolean;
  amount?: string;
  percentageAsOf?: Date | null;
}

const at = (iso: string) => new Date(iso);
const days = (list: Occurrence[]) => list.map((row) => row.date.toISOString().slice(0, 10));

/**
 * Just enough of Postgres for one series: the statements the materializer sends, told apart by
 * their text, played against an in-memory list of its occurrences. The real statements are
 * checked against a live database; this pins down what the materializer does with their answers.
 */
class FakeSeries {
  occurrences: Occurrence[] = [];
  frontier: Date | null = null;
  // The account's balance as of a moment, which a percentage or a rounding is worked out from.
  balanceAt: (asOf: Date) => string = () => '0.00';
  readonly manager = { query: (sql: string, params: unknown[]) => this.query(sql, params) } as unknown as EntityManager;

  live(): Occurrence[] {
    return this.occurrences.filter((row) => !row.deleted);
  }

  private async query(sql: string, params: unknown[]): Promise<unknown[]> {
    if (sql.includes('FOR UPDATE')) {
      return [];
    }
    if (sql.includes('SELECT 1 FROM transactions')) {
      const now = params[1] as Date;
      return this.occurrences.filter((row) => !row.deleted && row.date > now && row.recurrenceDate > now).map(() => ({}));
    }
    if (sql.includes('AS balance')) {
      return [{ balance: this.balanceAt(params[1] as Date) }];
    }
    if (sql.includes('INSERT INTO transactions')) {
      const date = params[2] as Date;
      // The unique index on (recurring_rule_id, recurrence_date), soft-deleted rows included.
      if (this.occurrences.some((row) => row.recurrenceDate.getTime() === date.getTime())) {
        return [];
      }
      this.occurrences.push({
        recurrenceDate: date,
        date,
        deleted: false,
        customized: false,
        amount: params[3] as string,
        percentageAsOf: params[14] as Date | null,
      });
      return [{ id: String(this.occurrences.length) }];
    }
    if (sql.includes('UPDATE recurring_rules')) {
      this.frontier = params[1] as Date;
      return [];
    }
    if (sql.includes('DELETE FROM transactions')) {
      const now = params[1] as Date;
      this.occurrences = this.occurrences.filter((row) => !(row.recurrenceDate > now && !row.customized && !row.deleted));
      return [];
    }
    throw new Error(`Unexpected statement: ${sql}`);
  }
}

function monthlyRule(startsAt: string): RecurringRule {
  return {
    id: 'rule',
    groupId: 'group',
    type: 'expense',
    amount: '100.00',
    currencyId: 1,
    accountId: 'account',
    categoryId: null,
    subcategoryId: null,
    toAccountId: null,
    note: null,
    percentage: null,
    percentageBase: null,
    roundBalanceTo: null,
    intervalUnit: 'month',
    intervalValue: 1,
    startsAt: at(startsAt),
    nextRunDate: at(startsAt),
    timezone: 'UTC',
    active: true,
    createdBy: 'user',
  } as unknown as RecurringRule;
}

describe('materializeOccurrences', () => {
  it('writes only the first occurrence of a series that starts ahead', async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-03-10T12:00:00Z');

    await materializeOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));

    expect(days(series.live())).toEqual(['2027-03-10']);
    // The frontier is the one after it, written once this one lands.
    expect(rule.nextRunDate.toISOString()).toBe('2027-04-10T12:00:00.000Z');
  });

  it('writes what already happened in a series started in the past, then its next one', async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-01-10T12:00:00Z');

    const inserted = await materializeOccurrences(series.manager, rule, at('2027-03-15T00:00:00Z'));

    expect(inserted).toBe(4);
    expect(days(series.live())).toEqual(['2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10']);
  });

  it('writes nothing while the planned occurrence is still ahead', async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-03-10T12:00:00Z');
    await materializeOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));

    const inserted = await materializeOccurrences(series.manager, rule, at('2027-03-09T00:00:00Z'));

    expect(inserted).toBe(0);
    expect(days(series.live())).toEqual(['2027-03-10']);
  });

  it('writes the next occurrence once the planned one lands', async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-03-10T12:00:00Z');
    await materializeOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));

    await materializeOccurrences(series.manager, rule, at('2027-03-10T12:05:00Z'));

    expect(days(series.live())).toEqual(['2027-03-10', '2027-04-10']);
  });

  it('catches up on every date that fell due while nothing ran', async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-03-10T12:00:00Z');
    await materializeOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));

    await materializeOccurrences(series.manager, rule, at('2027-05-20T00:00:00Z'));

    expect(days(series.live())).toEqual(['2027-03-10', '2027-04-10', '2027-05-10', '2027-06-10']);
  });

  it('moves on to the next occurrence when the planned one is deleted', async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-03-10T12:00:00Z');
    await materializeOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));
    series.occurrences[0].deleted = true;

    await materializeOccurrences(series.manager, rule, at('2027-03-02T00:00:00Z'));

    expect(days(series.live())).toEqual(['2027-04-10']);
  });

  it("isn't held back by an occurrence moved past its scheduled date once that date passes", async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-03-10T12:00:00Z');
    await materializeOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));
    Object.assign(series.occurrences[0], { date: at('2027-04-20T12:00:00Z'), customized: true });

    // Before its scheduled date, the moved one is still the planned occurrence.
    await materializeOccurrences(series.manager, rule, at('2027-03-05T00:00:00Z'));
    expect(days(series.live())).toEqual(['2027-04-20']);

    // Once it's passed, April's occurrence comes on time, not after the moved one lands.
    await materializeOccurrences(series.manager, rule, at('2027-03-11T00:00:00Z'));
    expect(days(series.live())).toEqual(['2027-04-20', '2027-04-10']);
  });

  it('moves on at once when the planned occurrence is moved to a date that has passed', async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-03-10T12:00:00Z');
    await materializeOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));
    Object.assign(series.occurrences[0], { date: at('2027-02-28T12:00:00Z'), customized: true });

    await materializeOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));

    expect(days(series.live())).toEqual(['2027-02-28', '2027-04-10']);
  });
});

describe('materializeOccurrences, for an amount from the balance', () => {
  const amounts = (list: Occurrence[]) => list.map((row) => [row.amount, row.percentageAsOf?.toISOString() ?? null]);

  it('works dates already past out from the balance on each, and estimates the planned one from the balance its date will have', async () => {
    const series = new FakeSeries();
    // The card's debt grows by 1,000 a month: 3% of it comes to 30 more each time.
    series.balanceAt = (asOf) => `-${1000 * (asOf.getUTCMonth() + 1)}.00`;
    const rule = { ...monthlyRule('2027-01-10T12:00:00Z'), percentage: '3', amount: '1.00' } as RecurringRule;
    const now = at('2027-03-15T00:00:00Z');

    await materializeOccurrences(series.manager, rule, now);

    expect(amounts(series.live())).toEqual([
      ['30.00', '2027-01-10T12:00:00.000Z'],
      ['60.00', '2027-02-10T12:00:00.000Z'],
      ['90.00', '2027-03-10T12:00:00.000Z'],
      // Worked out now, before its date: an estimate, which follows the account until the day.
      ['120.00', '2027-03-15T00:00:00.000Z'],
    ]);
  });

  it('rounds the balance down for money going out, and up for money coming in', async () => {
    // 2,234.56 in February, 3,234.56 in March, 4,234.56 in April.
    const balanceAt = (asOf: Date) => `${1000 * (asOf.getUTCMonth() + 1) + 234}.56`;
    const now = at('2027-03-15T00:00:00Z');

    const out = new FakeSeries();
    out.balanceAt = balanceAt;
    await materializeOccurrences(out.manager, { ...monthlyRule('2027-02-10T12:00:00Z'), roundBalanceTo: 100 } as RecurringRule, now);
    expect(amounts(out.live())).toEqual([
      ['34.56', '2027-02-10T12:00:00.000Z'],
      ['34.56', '2027-03-10T12:00:00.000Z'],
      ['34.56', '2027-03-15T00:00:00.000Z'],
    ]);

    const incoming = new FakeSeries();
    incoming.balanceAt = balanceAt;
    const income = { ...monthlyRule('2027-02-10T12:00:00Z'), type: 'income', roundBalanceTo: 1000 } as RecurringRule;
    await materializeOccurrences(incoming.manager, income, now);
    expect(amounts(incoming.live()).map(([amount]) => amount)).toEqual(['765.44', '765.44', '765.44']);
  });

  it('skips a date already past that comes to nothing, and plans the next one as nothing for now', async () => {
    const series = new FakeSeries();
    const rule = { ...monthlyRule('2027-02-10T12:00:00Z'), percentage: '3', amount: '45.00' } as RecurringRule;

    await materializeOccurrences(series.manager, rule, at('2027-03-15T00:00:00Z'));

    expect(days(series.live())).toEqual(['2027-04-10']);
    // An estimate: it follows the account until April, and goes then if it's still nothing.
    expect(amounts(series.live())).toEqual([['0.00', '2027-03-15T00:00:00.000Z']]);
  });

  it('comes to the same every time of a base amount, with no balance to name', async () => {
    const series = new FakeSeries();
    series.balanceAt = () => {
      throw new Error('no balance expected');
    };
    const rule = { ...monthlyRule('2027-02-10T12:00:00Z'), percentage: '5', percentageBase: '12000.50' } as RecurringRule;

    await materializeOccurrences(series.manager, rule, at('2027-03-15T00:00:00Z'));

    expect(amounts(series.live())).toEqual([
      ['600.03', null],
      ['600.03', null],
      ['600.03', null],
    ]);
  });
});

describe('regenerateOccurrences', () => {
  it('rewrites the planned occurrence from today on, leaving what happened alone', async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-01-10T12:00:00Z');
    await materializeOccurrences(series.manager, rule, at('2027-03-15T00:00:00Z'));

    rule.amount = '150.00';
    rule.startsAt = at('2027-03-20T12:00:00Z');
    await regenerateOccurrences(series.manager, rule, at('2027-03-15T00:00:00Z'));

    expect(days(series.live())).toEqual(['2027-01-10', '2027-02-10', '2027-03-10', '2027-03-20']);
  });

  it('keeps a planned occurrence the user edited, and carries on from the new schedule after it', async () => {
    const series = new FakeSeries();
    const rule = monthlyRule('2027-03-10T12:00:00Z');
    await materializeOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));
    series.occurrences[0].customized = true;

    rule.startsAt = at('2027-03-25T12:00:00Z');
    await regenerateOccurrences(series.manager, rule, at('2027-03-01T00:00:00Z'));
    expect(days(series.live())).toEqual(['2027-03-10']);
    expect(series.frontier?.toISOString()).toBe('2027-03-01T00:00:00.000Z');

    await materializeOccurrences(series.manager, rule, at('2027-03-11T00:00:00Z'));
    expect(days(series.live())).toEqual(['2027-03-10', '2027-03-25']);
  });
});

describe('nextOccurrence', () => {
  const now = at('2027-03-15T00:00:00Z');

  it("is the planned occurrence's scheduled date when there is one", () => {
    const rule = monthlyRule('2027-01-10T12:00:00Z');
    expect(nextOccurrence(rule, at('2027-04-10T12:00:00Z'), now)?.toISOString()).toBe('2027-04-10T12:00:00.000Z');
  });

  it('is the next scheduled date past the frontier while none is written', () => {
    const rule = monthlyRule('2027-01-10T12:00:00Z');
    // One landed and the next isn't written yet: the frontier is behind now.
    rule.nextRunDate = at('2027-03-10T12:00:00Z');
    expect(nextOccurrence(rule, undefined, now)?.toISOString()).toBe('2027-04-10T12:00:00.000Z');
    // The planned one was deleted: the frontier is already past it.
    rule.nextRunDate = at('2027-05-10T12:00:00Z');
    expect(nextOccurrence(rule, undefined, now)?.toISOString()).toBe('2027-05-10T12:00:00.000Z');
  });

  it('is null for a paused series', () => {
    const rule = monthlyRule('2027-01-10T12:00:00Z');
    rule.active = false;
    expect(nextOccurrence(rule, undefined, now)).toBeNull();
  });
});
