import { describe, expect, it } from 'vitest';
import { accountGroups, type Account } from './queries';

const account = (id: string, type: Account['type']) => ({ id, type }) as Account;
const shape = (accounts: Account[]) =>
  accountGroups(accounts).map(({ type, accounts: inGroup }) => [type, inGroup.map((a) => a.id)]);

describe('accountGroups', () => {
  it('offers what there is to spend with, then what is put aside, then what is owed', () => {
    const accounts = [
      account('owed-by-sam', 'debt'),
      account('rainy-day', 'savings'),
      account('wallet', 'regular'),
    ];

    expect(shape(accounts)).toEqual([
      ['regular', ['wallet']],
      ['savings', ['rainy-day']],
      ['debt', ['owed-by-sam']],
    ]);
  });

  it('keeps the order the accounts came in within a section', () => {
    const accounts = [
      account('card', 'regular'),
      account('loan', 'debt'),
      account('cash', 'regular'),
      account('iou', 'debt'),
    ];

    expect(shape(accounts)).toEqual([
      ['regular', ['card', 'cash']],
      ['debt', ['loan', 'iou']],
    ]);
  });

  it('leaves out a section with nothing in it', () => {
    expect(shape([account('wallet', 'regular'), account('loan', 'debt')])).toEqual([
      ['regular', ['wallet']],
      ['debt', ['loan']],
    ]);
    expect(shape([account('loan', 'debt')])).toEqual([['debt', ['loan']]]);
    expect(shape([])).toEqual([]);
  });

  it('hands back new lists rather than reordering the one it was given', () => {
    const accounts = [account('loan', 'debt'), account('wallet', 'regular')];

    expect(accountGroups(accounts)[0].accounts).not.toBe(accounts);
    expect(accounts.map((a) => a.id)).toEqual(['loan', 'wallet']);
  });
});
