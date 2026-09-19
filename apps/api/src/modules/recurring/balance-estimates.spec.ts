import type { EntityManager } from 'typeorm';
import { reworkEstimates } from './balance-estimates';

interface EstimateRow {
  id: string;
  group_id: string;
  type: string;
  account_id: string;
  date: Date;
  amount: string;
  percentage: string | null;
  percentage_base: string | null;
  round_balance_to: number | null;
}

const now = new Date('2026-09-19T12:00:00Z');
const ahead = new Date('2026-10-01T09:00:00Z');
const landed = new Date('2026-09-19T09:00:00Z');

const estimate = (id: string, date: Date, amount: string, fields: Partial<EstimateRow> = {}): EstimateRow => ({
  id,
  group_id: 'group',
  type: 'expense',
  account_id: 'card',
  date,
  amount,
  percentage: '3',
  percentage_base: null,
  round_balance_to: null,
  ...fields,
});

/**
 * The statements reworkEstimates sends, told apart by their text: the estimates it's given, the
 * balance leaving out each one by its id, and what it writes.
 */
function database(rows: EstimateRow[], balanceWithout: Record<string, string>) {
  const writes: string[] = [];
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FOR UPDATE')) {
        return rows;
      }
      if (sql.includes('AS balance')) {
        return [{ balance: balanceWithout[params[2] as string] }];
      }
      writes.push(sql.includes('deleted_at = now()') ? `delete ${params[0]}` : `set ${params[0]} ${params[1]} as of ${(params[2] as Date).toISOString()}`);
      return [];
    },
  } as unknown as EntityManager;
  return { manager, writes };
}

describe('reworkEstimates', () => {
  it('works a planned amount out again from its balance, and leaves one that holds as it is', async () => {
    const { manager, writes } = database(
      [estimate('changed', ahead, '300.00'), estimate('same', ahead, '330.00')],
      { changed: '-11000.00', same: '-11000.00' },
    );

    const reworked = await reworkEstimates(manager, ['card'], now);

    expect(writes).toEqual([`set changed 330.00 as of ${now.toISOString()}`]);
    expect(reworked).toEqual([{ id: 'changed', groupId: 'group', action: 'updated' }]);
  });

  it('works one that has landed out a last time as of its date, and drops one that comes to nothing', async () => {
    const { manager, writes } = database(
      [
        estimate('landed', landed, '330.00'),
        estimate('nothing', landed, '1.00', { round_balance_to: 100, percentage: null }),
      ],
      { landed: '-11000.00', nothing: '1200.00' },
    );

    const reworked = await reworkEstimates(manager, null, now);

    // Written even though the figure held: as of its date, it's no estimate now.
    expect(writes).toEqual([`set landed 330.00 as of ${landed.toISOString()}`, 'delete nothing']);
    expect(reworked.map(({ id, action }) => `${id} ${action}`)).toEqual(['landed updated', 'nothing deleted']);
  });

  it('keeps the figure a planned one had while it comes to nothing for now', async () => {
    const { manager, writes } = database([estimate('round', ahead, '34.56', { percentage: null, round_balance_to: 100 })], {
      round: '1200.00',
    });

    expect(await reworkEstimates(manager, ['card'], now)).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('rounds an income up and anything else down', async () => {
    const { manager, writes } = database(
      [
        estimate('in', ahead, '1.00', { type: 'income', percentage: null, round_balance_to: 100 }),
        estimate('out', ahead, '1.00', { type: 'transfer', percentage: null, round_balance_to: 100 }),
      ],
      { in: '1234.56', out: '1234.56' },
    );

    await reworkEstimates(manager, ['card'], now);

    expect(writes).toEqual([`set in 65.44 as of ${now.toISOString()}`, `set out 34.56 as of ${now.toISOString()}`]);
  });
});
