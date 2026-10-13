import type { Account, Category, RecurringRule, Transaction } from '@ft/api-database';
import { CurrencyCodes } from '../external-lookup.service';
import { amountSourceOf, transactionDescriber } from './mcp-describe';

const UAH = 1;
const currencies = new CurrencyCodes(new Map([[UAH, 'UAH']]));
const card = { id: 'acc-card', name: 'Card', currencyId: UAH } as Account;
const interest = { id: 'cat-interest', name: 'Interest', parentId: null, currencyId: null } as Category;
const monthly = { id: 'rule-1', intervalValue: 1, intervalUnit: 'month', active: true } as RecurringRule;
const now = new Date('2026-10-13T09:00:00Z');

const transaction = (overrides: Partial<Transaction> = {}) =>
  ({
    id: 'tx-1',
    type: 'expense',
    date: new Date('2026-11-01T10:00:00Z'),
    amount: '3342.87',
    currencyId: UAH,
    accountId: card.id,
    categoryId: interest.id,
    subcategoryId: null,
    toAccountId: null,
    destAmount: null,
    note: null,
    percentage: null,
    percentageBase: null,
    roundBalanceTo: null,
    percentageAsOf: null,
    recurringRuleId: null,
    isCustomized: false,
    ...overrides,
  }) as Transaction;

describe('amountSourceOf', () => {
  it('says a planned percentage of the balance follows it until its date', () => {
    expect(amountSourceOf(transaction({ percentage: '3.5000', percentageAsOf: new Date('2026-10-12T08:00:00Z') }), currencies)).toEqual({
      amountFrom: { percentage: '3.5', of: 'balance', followsBalance: true },
    });
  });

  it('stops following once worked out on its date', () => {
    const settled = transaction({ percentage: '3.5000', percentageAsOf: new Date('2026-11-01T10:00:00Z') });
    expect(amountSourceOf(settled, currencies)).toEqual({ amountFrom: { percentage: '3.5', of: 'balance' } });
  });

  it('names the fixed amount a percentage is of', () => {
    expect(amountSourceOf(transaction({ percentage: '100.0000', percentageBase: '12000.5' }), currencies)).toEqual({
      amountFrom: { percentage: '100', of: { amount: '12000.50', currency: 'UAH' } },
    });
  });

  it('says what a rounding rounds the balance to', () => {
    expect(amountSourceOf(transaction({ roundBalanceTo: 100, percentageAsOf: new Date('2026-10-12T08:00:00Z') }), currencies)).toEqual({
      amountFrom: { roundsBalanceTo: 100, followsBalance: true },
    });
  });

  it('says nothing of an amount typed as it is', () => {
    expect(amountSourceOf(transaction(), currencies)).toEqual({});
  });
});

describe('transactionDescriber', () => {
  const describe_ = transactionDescriber({
    accounts: [card],
    categories: [interest],
    series: [monthly],
    currencies,
    timeZone: 'Europe/Kyiv',
    now,
  });

  it('names the series a transaction belongs to, and an occurrence edited apart from it', () => {
    expect(describe_(transaction({ recurringRuleId: monthly.id, isCustomized: true }))).toMatchObject({
      planned: true,
      series: { every: 1, unit: 'month' },
      editedApartFromSeries: true,
    });
  });

  it('says a paused series is paused', () => {
    const paused = transactionDescriber({ accounts: [card], categories: [interest], series: [{ ...monthly, active: false } as RecurringRule], currencies, timeZone: 'UTC', now });
    expect(paused(transaction({ recurringRuleId: monthly.id })).series).toEqual({ every: 1, unit: 'month', paused: true });
  });

  it('leaves out what a plain transaction has none of', () => {
    const described = describe_(transaction({ date: new Date('2026-10-01T10:00:00Z') }));
    expect(described).not.toHaveProperty('series');
    expect(described).not.toHaveProperty('amountFrom');
    expect(described).not.toHaveProperty('planned');
  });
});
