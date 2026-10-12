import { totalByDay, type MoneyMoved } from './overview-days';

const UAH = 3;
const USD = 2;

const moved = (date: string, amount: string, overrides: Partial<MoneyMoved> = {}): MoneyMoved => ({
  date: new Date(date),
  type: 'expense',
  categoryId: 'cat-groceries',
  accountId: null,
  currencyId: UAH,
  amount,
  ...overrides,
});

describe('totalByDay', () => {
  it('adds up what went on the same thing on the same day', () => {
    expect(
      totalByDay([moved('2026-10-03T09:00:00Z', '120.50'), moved('2026-10-03T15:00:00Z', '79.50')], 'Europe/Kyiv'),
    ).toEqual([
      { day: '2026-10-03', type: 'expense', categoryId: 'cat-groceries', accountId: null, currencyId: UAH, amount: '200.00' },
    ]);
  });

  it('counts the day in the time zone it was asked for', () => {
    // 22:30 UTC on the 3rd is already the 4th in Kyiv (UTC+3), and still the 3rd in New York.
    const late = [moved('2026-10-03T22:30:00Z', '10.00')];
    expect(totalByDay(late, 'Europe/Kyiv')[0].day).toBe('2026-10-04');
    expect(totalByDay(late, 'America/New_York')[0].day).toBe('2026-10-03');
  });

  it('keeps categories, debts, types and currencies apart', () => {
    const totals = totalByDay(
      [
        moved('2026-10-05T10:00:00Z', '100.00'),
        moved('2026-10-05T10:00:00Z', '5.00', { currencyId: USD }),
        moved('2026-10-05T10:00:00Z', '40.00', { categoryId: null }),
        moved('2026-10-05T10:00:00Z', '300.00', { categoryId: null, accountId: 'acc-loan' }),
        moved('2026-10-05T10:00:00Z', '900.00', { type: 'income', categoryId: 'cat-salary' }),
      ],
      'UTC',
    );
    expect(totals).toHaveLength(5);
    expect(totals.map((total) => total.type)).toEqual(['expense', 'expense', 'expense', 'expense', 'income']);
  });

  it('orders by day and leaves out what came to nothing', () => {
    const totals = totalByDay(
      [moved('2026-10-09T10:00:00Z', '1.00'), moved('2026-10-02T10:00:00Z', '0.00'), moved('2026-10-01T10:00:00Z', '2.00')],
      'UTC',
    );
    expect(totals.map((total) => total.day)).toEqual(['2026-10-01', '2026-10-09']);
  });
});
