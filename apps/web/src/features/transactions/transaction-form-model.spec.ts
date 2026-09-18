import { describe, expect, it } from 'vitest';
import {
  defaultTransactionFormValues,
  pickDefaultAccountId,
  toTransactionBody,
  transactionFormSchema,
  type TransactionFormValues,
} from './transaction-form-model';

const usd = { id: '00000000-0000-4000-8000-000000000001', currencyId: 1 };
const usd2 = { id: '00000000-0000-4000-8000-000000000002', currencyId: 1 };
const eur = { id: '00000000-0000-4000-8000-000000000003', currencyId: 2 };
const accounts = [usd, usd2, eur];
const now = new Date(2026, 8, 17, 15, 30);
const messages = { required: 'required', amount: 'amount', sameAccount: 'same' };

const values = (overrides: Partial<TransactionFormValues>): TransactionFormValues => ({
  ...defaultTransactionFormValues({ accountId: usd.id, now }),
  amount: '10',
  ...overrides,
});

const issues = (input: TransactionFormValues) => {
  const result = transactionFormSchema(accounts, messages).safeParse(input);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
};

describe('transactionFormSchema', () => {
  it('accepts a plain expense', () => {
    expect(issues(values({}))).toEqual({});
  });

  it('rejects a zero or malformed amount', () => {
    expect(issues(values({ amount: '0' }))).toEqual({ amount: 'amount' });
    expect(issues(values({ amount: 'ten' }))).toEqual({ amount: 'amount' });
  });

  it('requires a different destination for a transfer', () => {
    expect(issues(values({ type: 'transfer' }))).toEqual({ toAccountId: 'required' });
    expect(issues(values({ type: 'transfer', toAccountId: usd.id }))).toEqual({ toAccountId: 'same' });
  });

  it('requires the received amount only across currencies', () => {
    expect(issues(values({ type: 'transfer', toAccountId: usd2.id }))).toEqual({});
    expect(issues(values({ type: 'transfer', toAccountId: eur.id }))).toEqual({ destAmount: 'amount' });
    expect(issues(values({ type: 'transfer', toAccountId: eur.id, destAmount: '9,20' }))).toEqual({});
  });
});

describe('toTransactionBody', () => {
  it('builds an expense in the account currency', () => {
    const body = toTransactionBody(values({ amount: '12,5', categoryId: 'cat', note: '  lunch ' }), accounts, undefined, now);
    expect(body).toEqual({
      type: 'expense',
      date: now.toISOString(),
      amount: '12.5',
      currencyId: 1,
      accountId: usd.id,
      categoryId: 'cat',
      subcategoryId: null,
      toAccountId: null,
      destAmount: null,
      note: 'lunch',
    });
  });

  it('sends a subcategory only together with its category', () => {
    const body = (overrides: Partial<TransactionFormValues>) => toTransactionBody(values(overrides), accounts, undefined, now);
    expect(body({ categoryId: 'transport', subcategoryId: 'taxi' })).toMatchObject({
      categoryId: 'transport',
      subcategoryId: 'taxi',
    });
    expect(body({ categoryId: '', subcategoryId: 'taxi' })).toMatchObject({ categoryId: null, subcategoryId: null });
  });

  it('drops the category and keeps destAmount for a cross-currency transfer', () => {
    const body = toTransactionBody(
      values({ type: 'transfer', categoryId: 'stale', subcategoryId: 'stale', toAccountId: eur.id, destAmount: '9.2' }),
      accounts,
      undefined,
      now,
    );
    expect(body).toMatchObject({ categoryId: null, subcategoryId: null, toAccountId: eur.id, destAmount: '9.2' });
  });

  it('ignores a leftover destAmount once currencies match', () => {
    const body = toTransactionBody(values({ type: 'transfer', toAccountId: usd2.id, destAmount: '5' }), accounts, undefined, now);
    expect(body.destAmount).toBeNull();
  });

  it('clears the note on edit but omits it on create', () => {
    const existing = { date: new Date(2026, 8, 1, 9).toISOString() };
    expect(toTransactionBody(values({ day: '2026-09-01' }), accounts, existing, now)).toMatchObject({
      note: '',
      date: existing.date,
    });
    expect(toTransactionBody(values({}), accounts, undefined, now).note).toBeUndefined();
  });
});

describe('pickDefaultAccountId', () => {
  const list = [
    { ...usd, isFavourite: false },
    { ...usd2, isFavourite: true },
    { ...eur, isFavourite: true },
  ];

  it('uses the requested account when it exists', () => {
    expect(pickDefaultAccountId(list, eur.id)).toBe(eur.id);
  });

  it('prefers a regular account over one listed earlier when none is a favourite', () => {
    const typed = [
      { ...usd, isFavourite: false, type: 'savings' },
      { ...usd2, isFavourite: false, type: 'regular' },
    ];
    expect(pickDefaultAccountId(typed)).toBe(usd2.id);
    expect(pickDefaultAccountId(typed.map((account) => ({ ...account, type: 'debt' })))).toBe(usd.id);
  });

  it('falls back to the first favourite, then to the first account', () => {
    expect(pickDefaultAccountId(list)).toBe(usd2.id);
    expect(pickDefaultAccountId(list, 'deleted-account')).toBe(usd2.id);
    expect(pickDefaultAccountId(list.map((account) => ({ ...account, isFavourite: false })))).toBe(usd.id);
    expect(pickDefaultAccountId([])).toBeUndefined();
  });
});
