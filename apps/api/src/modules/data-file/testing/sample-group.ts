import type { GroupSnapshot, SnapshotTransaction } from '../export-tables';

// A group for the data file's specs to export and read back.

export const NOW = new Date('2026-09-21T12:00:00.000Z');

const base: Omit<SnapshotTransaction, 'type' | 'date' | 'amount' | 'accountId'> = {
  categoryId: null,
  subcategoryId: null,
  toAccountId: null,
  destAmount: null,
  destAmountAsOf: null,
  note: null,
  percentage: null,
  percentageBase: null,
  roundBalanceTo: null,
  tags: [],
  recurringRuleId: null,
  recurrenceDate: null,
};

const account = { isIncludedInBalance: true, isFavourite: false, archived: false, description: null, icon: null, color: null, limitAmount: null, goalAmount: null };
const category = { icon: null, color: null, archived: false };

/**
 * A group with a little of everything the file carries: two accounts of one name in different
 * currencies and two in the same one, a subcategory, a transfer between currencies, a series with
 * its planned transaction, and a received amount that's still an estimate.
 */
export function sampleSnapshot(): GroupSnapshot {
  return {
    accounts: [
      { ...account, id: 'cash', name: 'Cash', currency: 'UAH', type: 'regular', balance: '2879.50', isFavourite: true, icon: 'wallet' },
      { ...account, id: 'card', name: 'Card', currency: 'UAH', type: 'regular', balance: '-300.00', color: '#3b82f6' },
      { ...account, id: 'card-usd', name: 'Card', currency: 'USD', type: 'savings', balance: '100.00', goalAmount: '5000.00' },
      // The same name and currency as the first: an old one, archived, and another account entirely.
      { ...account, id: 'old-cash', name: 'cash', currency: 'UAH', type: 'regular', balance: '0.00', archived: true },
    ],
    categories: [
      { ...category, id: 'food', parentId: null, type: 'expense', name: 'Food', icon: 'utensils' },
      { ...category, id: 'groceries', parentId: 'food', type: 'expense', name: 'Groceries' },
      { ...category, id: 'rent', parentId: null, type: 'expense', name: 'Rent' },
      { ...category, id: 'salary', parentId: null, type: 'income', name: 'Salary', archived: true },
    ],
    transactions: [
      { ...base, type: 'income', date: new Date('2026-09-01T09:00:00Z'), amount: '3000.00', accountId: 'cash', categoryId: 'salary' },
      {
        ...base,
        type: 'expense',
        date: new Date('2026-09-02T18:30:15Z'),
        amount: '120.50',
        accountId: 'cash',
        categoryId: 'food',
        subcategoryId: 'groceries',
        note: '=milk, "bread"',
        tags: ['home', 'weekly'],
      },
      {
        ...base,
        type: 'transfer',
        date: new Date('2026-09-03T10:00:00Z'),
        amount: '4100.00',
        accountId: 'card',
        toAccountId: 'card-usd',
        destAmount: '100.00',
        destAmountAsOf: new Date('2026-09-03T10:00:00Z'),
      },
      // The series' planned transaction: ahead, and scheduled for the date it's on — midnight on
      // the 1st in Tokyo.
      {
        ...base,
        type: 'expense',
        date: new Date('2026-09-30T15:00:00Z'),
        amount: '500.00',
        accountId: 'card',
        categoryId: 'rent',
        recurringRuleId: 'rent-series',
        recurrenceDate: new Date('2026-09-30T15:00:00Z'),
      },
      // A planned transfer converted at the latest rate: an estimate, left for the import to convert.
      {
        ...base,
        type: 'transfer',
        date: new Date('2026-09-30T12:00:00Z'),
        amount: '410.00',
        accountId: 'card',
        toAccountId: 'card-usd',
        destAmount: '10.00',
        destAmountAsOf: new Date('2026-09-21T11:00:00Z'),
      },
      // Moving money into the old account, which is why the two must come back apart.
      { ...base, type: 'transfer', date: new Date('2026-09-04T10:00:00Z'), amount: '1.00', accountId: 'old-cash', toAccountId: 'cash' },
    ],
    series: [
      {
        id: 'rent-series',
        type: 'expense',
        amount: '500.00',
        accountId: 'card',
        categoryId: 'rent',
        subcategoryId: null,
        toAccountId: null,
        note: null,
        percentage: null,
        percentageBase: null,
        roundBalanceTo: null,
        intervalUnit: 'month',
        intervalValue: 1,
        // Midnight on the 1st in Tokyo, which is 15:00 the day before in UTC.
        startsAt: new Date('2026-01-31T15:00:00Z'),
        nextOccurrence: new Date('2026-09-30T15:00:00Z'),
        timezone: 'Asia/Tokyo',
        active: true,
        reminderDaysBefore: null,
      },
    ],
  };
}
