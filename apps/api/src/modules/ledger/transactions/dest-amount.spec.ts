import { convertedDest, planDestAmount, type StoredDest } from './dest-amount';

const DAY = 24 * 60 * 60 * 1000;
const today = new Date('2026-09-19T12:00:00Z');
const nextWeek = new Date(today.getTime() + 7 * DAY);
const lastWeek = new Date(today.getTime() - 7 * DAY);

function stored(overrides: Partial<StoredDest> = {}): StoredDest {
  return { destAmount: '4466.81', destAmountAsOf: null, sameCurrencies: true, ...overrides };
}

describe('planDestAmount', () => {
  it('takes a figure the write names as typed', () => {
    expect(planDestAmount('4500.00', stored(), today)).toEqual({ kind: 'typed', destAmount: '4500.00' });
  });

  it('converts when the write asks for it with null', () => {
    expect(planDestAmount(null, stored(), today)).toEqual({ kind: 'convert' });
  });

  it('converts on create when no figure is named', () => {
    expect(planDestAmount(undefined, null, today)).toEqual({ kind: 'convert' });
  });

  it('keeps a typed figure an update does not name', () => {
    expect(planDestAmount(undefined, stored(), nextWeek)).toEqual({ kind: 'keep' });
  });

  it('keeps a converted figure that has since landed', () => {
    expect(planDestAmount(undefined, stored({ destAmountAsOf: lastWeek }), lastWeek)).toEqual({ kind: 'keep' });
  });

  it('converts again an estimate still ahead of its date', () => {
    expect(planDestAmount(undefined, stored({ destAmountAsOf: today }), nextWeek)).toEqual({ kind: 'convert' });
  });

  it('converts a landed figure moved ahead of today, which makes it an estimate again', () => {
    // Converted as of last week, on last week's date; now moved to next week.
    expect(planDestAmount(undefined, stored({ destAmountAsOf: lastWeek }), nextWeek)).toEqual({ kind: 'convert' });
  });

  it('converts when the two accounts are now in another pair of currencies', () => {
    expect(planDestAmount(undefined, stored({ sameCurrencies: false }), today)).toEqual({ kind: 'convert' });
  });

  it('converts when there was no figure to keep', () => {
    expect(planDestAmount(undefined, stored({ destAmount: null }), today)).toEqual({ kind: 'convert' });
  });
});

describe('convertedDest', () => {
  it('works the amount out at the rate, to the cent', () => {
    expect(convertedDest('100.00', '44.66806868')).toBe('4466.81');
  });

  it('has nothing to receive for an amount that is nothing for now', () => {
    expect(convertedDest('0.00', '44.67')).toBeNull();
  });

  it('never rounds something sent down to nothing received', () => {
    // 0.01 UAH is 0.0002 USD.
    expect(convertedDest('0.01', '0.02238925')).toBe('0.01');
  });
});
