import { describe, expect, it } from 'vitest';
import { debtsLast, type Account } from './queries';

const account = (id: string, type: Account['type']) => ({ id, type }) as Account;
const ids = (accounts: Account[]) => accounts.map((account) => account.id);

describe('debtsLast', () => {
  it('moves the debts below everything else', () => {
    const accounts = [
      account('owed-by-sam', 'debt'),
      account('wallet', 'regular'),
      account('rainy-day', 'savings'),
      account('owed-to-bank', 'debt'),
    ];

    expect(ids(debtsLast(accounts))).toEqual(['wallet', 'rainy-day', 'owed-by-sam', 'owed-to-bank']);
  });

  it('keeps the order they came in on either side of that', () => {
    const accounts = [
      account('card', 'regular'),
      account('loan', 'debt'),
      account('cash', 'regular'),
      account('iou', 'debt'),
      account('savings', 'savings'),
    ];

    expect(ids(debtsLast(accounts))).toEqual(['card', 'cash', 'savings', 'loan', 'iou']);
  });

  it('leaves a list with no debts, or nothing but debts, as it found it', () => {
    const noDebts = [account('a', 'regular'), account('b', 'savings')];
    const allDebts = [account('x', 'debt'), account('y', 'debt')];

    expect(ids(debtsLast(noDebts))).toEqual(['a', 'b']);
    expect(ids(debtsLast(allDebts))).toEqual(['x', 'y']);
    expect(debtsLast([])).toEqual([]);
  });

  it('hands back a new list rather than reordering the one it was given', () => {
    const accounts = [account('loan', 'debt'), account('wallet', 'regular')];
    const sorted = debtsLast(accounts);

    expect(sorted).not.toBe(accounts);
    expect(ids(accounts)).toEqual(['loan', 'wallet']);
  });
});
