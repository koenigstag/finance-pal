import type { EntityManager } from 'typeorm';
import { reworkRateEstimates } from './rate-estimates';

interface RateEstimateRow {
  id: string;
  group_id: string;
  date: Date;
  amount: string;
  dest_amount: string | null;
  from_code: string;
  to_code: string;
}

const now = new Date('2026-09-19T12:00:00Z');
const ahead = new Date('2026-10-01T09:00:00Z');
const landed = new Date('2026-09-19T09:00:00Z');

const estimate = (id: string, date: Date, amount: string, destAmount: string | null, fields: Partial<RateEstimateRow> = {}): RateEstimateRow => ({
  id,
  group_id: 'group',
  date,
  amount,
  dest_amount: destAmount,
  from_code: 'USD',
  to_code: 'UAH',
  ...fields,
});

/** The estimates reworkRateEstimates is given, and what it writes, told apart by statement. */
function database(rows: RateEstimateRow[]) {
  const writes: string[] = [];
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      if (sql.includes('FOR UPDATE')) {
        return rows;
      }
      writes.push(`set ${params[0]} ${params[1]} as of ${params[3] ? 'its date' : (params[2] as Date).toISOString()}`);
      return [];
    },
  } as unknown as EntityManager;
  return { manager, writes };
}

const rates = (quoted: Record<string, string | null>) => {
  const asked: string[] = [];
  const lookup = async (from: string, to: string) => {
    asked.push(`${from}>${to}`);
    return quoted[`${from}>${to}`] ?? null;
  };
  return { lookup, asked };
};

describe('reworkRateEstimates', () => {
  it('converts a planned amount again at the latest rate, and leaves one that holds as it is', async () => {
    const { manager, writes } = database([
      estimate('moved', ahead, '100.00', '4400.00'),
      estimate('same', ahead, '100.00', '4466.81'),
    ]);
    const { lookup } = rates({ 'USD>UAH': '44.66806868' });

    const reworked = await reworkRateEstimates(manager, lookup, null, now);

    expect(writes).toEqual([`set moved 4466.81 as of ${now.toISOString()}`]);
    expect(reworked.map((row) => row.id)).toEqual(['moved']);
  });

  it('fixes one whose date has come at that day’s rate, even when the figure holds', async () => {
    const { manager, writes } = database([estimate('due', landed, '100.00', '4466.81')]);
    const { lookup } = rates({ 'USD>UAH': '44.66806868' });

    await reworkRateEstimates(manager, lookup, null, now);

    expect(writes).toEqual(['set due 4466.81 as of its date']);
  });

  it('follows what is sent: an amount worked out from a balance moves what arrives', async () => {
    // The balance rework has just made it 150; the received amount still says 100's worth.
    const { manager, writes } = database([estimate('grown', ahead, '150.00', '4466.81')]);
    const { lookup } = rates({ 'USD>UAH': '44.66806868' });

    await reworkRateEstimates(manager, lookup, null, now);

    expect(writes).toEqual([`set grown 6700.21 as of ${now.toISOString()}`]);
  });

  it('receives nothing for an amount that comes to nothing for now', async () => {
    const { manager, writes } = database([estimate('nothing', ahead, '0.00', '4466.81')]);
    const { lookup } = rates({ 'USD>UAH': '44.66806868' });

    await reworkRateEstimates(manager, lookup, null, now);

    expect(writes).toEqual([`set nothing null as of ${now.toISOString()}`]);
  });

  it('without a rate keeps an estimate as it was, and fixes one that lands at its last figure', async () => {
    const { manager, writes } = database([
      estimate('waiting', ahead, '100.00', '4400.00'),
      estimate('due', landed, '100.00', '4400.00'),
    ]);
    const { lookup } = rates({});

    await reworkRateEstimates(manager, lookup, null, now);

    // Crediting the amount sent, in the wrong currency, would be far worse than a stale rate.
    expect(writes).toEqual(['set due 4400.00 as of its date']);
  });

  it('asks for each pair once a run, however many transfers share it', async () => {
    const { manager } = database([
      estimate('a', ahead, '100.00', '1.00'),
      estimate('b', ahead, '200.00', '1.00'),
      estimate('c', ahead, '50.00', '1.00', { from_code: 'EUR' }),
    ]);
    const { lookup, asked } = rates({ 'USD>UAH': '44.66806868', 'EUR>UAH': '51.34' });

    await reworkRateEstimates(manager, lookup, null, now);

    expect(asked).toEqual(['USD>UAH', 'EUR>UAH']);
  });
});
