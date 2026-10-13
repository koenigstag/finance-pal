import { collapse, diffOf, sameRow, touchedKey, undoBlockers, undoDiffOf, undoOrder, type RecordedWrite, type Row } from './change-rows';

const madeAt = new Date('2026-10-13T12:00:00Z');

const coffee: Row = {
  id: 'tx-1',
  group_id: 'g-1',
  type: 'expense',
  date: '2026-11-01T10:00:00+00:00',
  amount: 85,
  note: 'Coffee',
  percentage: null,
  round_balance_to: null,
  dest_amount: null,
  dest_amount_as_of: null,
  deleted_at: null,
  updated_at: '2026-10-13T12:00:00+00:00',
};

let seq = 0;
const write = (op: RecordedWrite['op'], oldRow: Row | null, newRow: Row | null, table: RecordedWrite['table'] = 'transactions'): RecordedWrite => ({
  seq: ++seq,
  table,
  rowId: String((newRow ?? oldRow)?.id),
  op,
  oldRow,
  newRow,
});

describe('collapse', () => {
  it('keeps each row as the change found it and left it, however often it was written', () => {
    const moved = { ...coffee, date: '2026-11-02T10:00:00+00:00' };
    const repriced = { ...moved, amount: 90 };
    const [row] = collapse([write('UPDATE', coffee, moved), write('UPDATE', moved, repriced)]);
    expect(row).toMatchObject({ table: 'transactions', rowId: 'tx-1', before: coffee, after: repriced });
  });

  it('leaves out a row made and removed again, or written back as it was', () => {
    const budget = { id: 'b-1', month: '2026-11-01', amount: 100 };
    expect(collapse([write('INSERT', null, budget, 'budgets'), write('DELETE', budget, null, 'budgets')])).toEqual([]);
    expect(collapse([write('UPDATE', coffee, { ...coffee, updated_at: '2026-10-13T12:05:00+00:00' })])).toEqual([]);
  });

  it("leaves out an account whose cached balance was all that moved: its transactions' trigger keeps that", () => {
    const card = { id: 'acc-1', name: 'Card', cached_balance: 0 };
    expect(collapse([write('UPDATE', card, { ...card, cached_balance: -120 }, 'accounts')])).toEqual([]);
    const [renamed] = collapse([write('UPDATE', card, { ...card, name: 'Cash', cached_balance: -120 }, 'accounts')]);
    expect(diffOf(renamed)).toMatchObject({ before: { name: 'Card' }, after: { name: 'Cash' } });
    expect(diffOf(renamed).after).not.toHaveProperty('cachedBalance');
  });
});

describe('sameRow', () => {
  it('leaves the figures the app works out again out of it', () => {
    const fromBalance = { ...coffee, percentage: 3.5 };
    expect(sameRow('transactions', fromBalance, { ...fromBalance, amount: 120, percentage_as_of: '2026-10-14T00:00:00+00:00' })).toBe(true);
    expect(sameRow('transactions', coffee, { ...coffee, amount: 120 })).toBe(false);
    const converted = { ...coffee, dest_amount: 2, dest_amount_as_of: '2026-10-13T12:00:00+00:00' };
    expect(sameRow('transactions', converted, { ...converted, dest_amount: 2.1 })).toBe(true);
  });

  it('reads one moment written two ways as one', () => {
    expect(sameRow('transactions', coffee, { ...coffee, date: '2026-11-01T12:00:00+02:00' })).toBe(true);
  });
});

describe('undoBlockers', () => {
  const now = new Date('2026-10-20T12:00:00Z');

  it('find nothing in the way while every row is as the change left it', () => {
    const touched = collapse([write('INSERT', null, coffee)]);
    expect(undoBlockers(touched, new Map([[touchedKey('transactions', 'tx-1'), coffee]]), madeAt, now)).toEqual([]);
  });

  it('stop at a row changed or deleted since', () => {
    const touched = collapse([write('INSERT', null, coffee)]);
    const changed = new Map([[touchedKey('transactions', 'tx-1'), { ...coffee, note: 'Tea' }]]);
    expect(undoBlockers(touched, changed, madeAt, now)).toEqual([
      { what: 'transaction', id: 'tx-1', label: 'expense 85 Coffee on 2026-11-01', reason: 'it has been changed since' },
    ]);
    expect(undoBlockers(touched, new Map(), madeAt, now)[0].reason).toBe('it has been deleted since');
  });

  it('stop at a transaction that was planned then and has happened since', () => {
    const touched = collapse([write('INSERT', null, coffee)]);
    const current = new Map([[touchedKey('transactions', 'tx-1'), coffee]]);
    expect(undoBlockers(touched, current, madeAt, new Date('2026-11-02T00:00:00Z'))[0].reason).toMatch(/has happened since/);
  });

  it('let history the change touched be put back', () => {
    // A deleted category leaves last month's coffee uncategorized; undoing files it again.
    const lastMonth = { ...coffee, date: '2026-09-01T10:00:00+00:00', category_id: 'cat-1' };
    const uncategorized = { ...lastMonth, category_id: null };
    const touched = collapse([write('UPDATE', lastMonth, uncategorized)]);
    expect(undoBlockers(touched, new Map([[touchedKey('transactions', 'tx-1'), uncategorized]]), madeAt, now)).toEqual([]);
  });
});

describe('undoOrder', () => {
  it('takes away last what the change made first', () => {
    const rule = { id: 'rule-1', type: 'expense', amount: 10 };
    const occurrence = { ...coffee, id: 'tx-2', recurring_rule_id: 'rule-1' };
    const touched = collapse([write('INSERT', null, rule, 'recurring_rules'), write('INSERT', null, occurrence)]);
    expect(undoOrder(touched).map((row) => row.rowId)).toEqual(['tx-2', 'rule-1']);
  });
});

describe('diffOf', () => {
  it('shows what was added, without what tells nothing', () => {
    const [row] = collapse([write('INSERT', null, coffee)]);
    expect(diffOf(row)).toEqual({
      what: 'transaction',
      id: 'tx-1',
      change: 'added',
      label: 'expense 85 Coffee on 2026-11-01',
      after: { type: 'expense', date: '2026-11-01T10:00:00+00:00', amount: 85, note: 'Coffee' },
    });
  });

  it('shows only what changed', () => {
    const [row] = collapse([write('UPDATE', coffee, { ...coffee, amount: 90, updated_at: 'later' })]);
    expect(diffOf(row)).toMatchObject({ change: 'changed', before: { amount: 85 }, after: { amount: 90 } });
  });

  it('reads a soft delete as a deletion, and its undoing as a restore', () => {
    const [row] = collapse([write('UPDATE', coffee, { ...coffee, deleted_at: '2026-10-13T12:00:00+00:00' })]);
    expect(diffOf(row).change).toBe('deleted');
    expect(undoDiffOf(row).change).toBe('restored');
  });

  it('names an account by its name, and a budget line by its month', () => {
    const [account] = collapse([write('INSERT', null, { id: 'acc-1', name: 'Card', currency_id: 1 }, 'accounts')]);
    expect(diffOf(account)).toMatchObject({ what: 'account', label: 'Card', after: { name: 'Card', currencyId: 1 } });
    const [line] = collapse([write('DELETE', { id: 'b-1', month: '2026-11-01', amount: 5000 }, null, 'budgets')]);
    expect(diffOf(line)).toMatchObject({ what: 'budget line', change: 'deleted', label: '2026-11: 5000' });
  });
});
