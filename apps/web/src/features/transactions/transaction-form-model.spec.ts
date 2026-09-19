import { describe, expect, it } from 'vitest';
import type { RecurringRule, Transaction } from './queries';
import {
  amountFormSchema,
  amountFromPercentage,
  balanceBase,
  defaultTransactionFormValues,
  isAhead,
  isPlannedDay,
  isPlannedOccurrence,
  pickDefaultAccountId,
  plannedToRecurringRuleBody,
  ruleToFormValues,
  schedulePatch,
  toRecurringRuleBody,
  toRecurringRulePatch,
  toTransactionBody,
  transactionFormSchema,
  type TransactionFormContext,
  type TransactionFormValues,
} from './transaction-form-model';

const usd = { id: '00000000-0000-4000-8000-000000000001', currencyId: 1 };
const usd2 = { id: '00000000-0000-4000-8000-000000000002', currencyId: 1 };
const eur = { id: '00000000-0000-4000-8000-000000000003', currencyId: 2 };
const accounts = [usd, usd2, eur];
const now = new Date(2026, 8, 17, 15, 30);
const messages = {
  required: 'required',
  amount: 'amount',
  sameAccount: 'same',
  repeatCurrency: 'currency',
  pastNextDate: 'past',
  percentage: 'percentage',
  percentageAmount: 'percentageAmount',
};

const values = (overrides: Partial<TransactionFormValues>): TransactionFormValues => ({
  ...defaultTransactionFormValues({ accountId: usd.id, now }),
  amount: '10',
  ...overrides,
});

const issues = (input: TransactionFormValues, context?: TransactionFormContext) => {
  const result = transactionFormSchema(accounts, messages, context).safeParse(input);
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

  it('lets a transfer repeat only within one currency', () => {
    expect(issues(values({ type: 'transfer', toAccountId: usd2.id, repeat: 'month:1' }))).toEqual({});
    expect(issues(values({ type: 'transfer', toAccountId: eur.id, destAmount: '9', repeat: 'month:1' }))).toEqual({
      repeat: 'currency',
    });
  });

  it("refuses to move a series' next date into the past, but lets an old one stand", () => {
    const context = { seriesNextDay: '2026-09-10', today: '2026-09-17' };
    expect(issues(values({ day: '2026-09-10', repeat: 'month:1' }), context)).toEqual({});
    expect(issues(values({ day: '2026-09-12', repeat: 'month:1' }), context)).toEqual({ day: 'past' });
    expect(issues(values({ day: '2026-09-17', repeat: 'month:1' }), context)).toEqual({});
    // A new series may start in the past: what's due since is recorded.
    expect(issues(values({ day: '2026-09-12', repeat: 'month:1' }), { today: '2026-09-17' })).toEqual({});
  });

  it('takes a percentage above 0 and up to 100', () => {
    expect(issues(values({ percentage: '3,5' }))).toEqual({});
    expect(issues(values({ percentage: '150' }))).toEqual({ percentage: 'percentage' });
    expect(issues(values({ percentage: '0' }))).toEqual({ percentage: 'percentage' });
  });

  it('says a percentage came to nothing rather than asking for an amount', () => {
    expect(issues(values({ percentage: '3', amount: '0.00' }))).toEqual({ amount: 'percentageAmount' });
    // Until the percentage itself is right, that's the one thing to fix.
    expect(issues(values({ percentage: 'x', amount: '0' }))).toEqual({ percentage: 'percentage' });
  });

  it('takes a base amount above zero beside a percentage, and ignores one without', () => {
    expect(issues(values({ percentage: '5', percentageBase: '12 000,50' }))).toEqual({});
    expect(issues(values({ percentage: '5', percentageBase: '0', amount: '0.00' }))).toEqual({ percentageBase: 'amount' });
    expect(issues(values({ percentage: '5', percentageBase: 'x' }))).toEqual({ percentageBase: 'amount' });
    expect(issues(values({ percentageBase: 'x' }))).toEqual({});
  });
});

describe('amountFormSchema', () => {
  const sheetIssues = (sides: Partial<TransactionFormValues>, overrides: Partial<TransactionFormValues>) => {
    const { type, accountId, toAccountId, amount, destAmount, percentage, percentageBase } = values({ ...sides, ...overrides });
    const result = amountFormSchema({ type, accountId, toAccountId }, accounts, messages).safeParse({
      amount,
      destAmount,
      percentage,
      percentageBase,
    });
    return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
  };

  it('checks the figures the way the form does', () => {
    expect(sheetIssues({}, {})).toEqual({});
    expect(sheetIssues({}, { amount: '0' })).toEqual({ amount: 'amount' });
    expect(sheetIssues({}, { percentage: '150' })).toEqual({ percentage: 'percentage' });
    expect(sheetIssues({}, { percentage: '5', percentageBase: '0', amount: '0.00' })).toEqual({ percentageBase: 'amount' });
  });

  it('asks for what arrived only across currencies', () => {
    expect(sheetIssues({ type: 'transfer', toAccountId: usd2.id }, {})).toEqual({});
    expect(sheetIssues({ type: 'transfer', toAccountId: eur.id }, {})).toEqual({ destAmount: 'amount' });
    expect(sheetIssues({ type: 'transfer', toAccountId: eur.id }, { destAmount: '9,20' })).toEqual({});
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
      percentage: null,
      percentageBase: null,
      note: 'lunch',
    });
  });

  it('sends the percentage the amount came from, and null once it is cleared', () => {
    expect(toTransactionBody(values({ percentage: ' 3,5 ' }), accounts, undefined, now).percentage).toBe('3.5');
    expect(toTransactionBody(values({ percentage: '' }), accounts, undefined, now).percentage).toBeNull();
  });

  it('sends a base amount only with its percentage', () => {
    const body = (overrides: Partial<TransactionFormValues>) => toTransactionBody(values(overrides), accounts, undefined, now);
    expect(body({ percentage: '5', percentageBase: '12 000,5' })).toMatchObject({ percentage: '5', percentageBase: '12000.5' });
    expect(body({ percentage: '5', percentageBase: ' ' })).toMatchObject({ percentage: '5', percentageBase: null });
    expect(body({ percentage: '', percentageBase: '12000' })).toMatchObject({ percentage: null, percentageBase: null });
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

const rule = (overrides: Partial<RecurringRule>): RecurringRule => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  groupId: '00000000-0000-4000-8000-0000000000bb',
  type: 'expense',
  amount: '9000.00',
  currencyId: 1,
  accountId: usd.id,
  categoryId: 'rent',
  subcategoryId: null,
  toAccountId: null,
  note: null,
  percentage: null,
  percentageBase: null,
  intervalUnit: 'month',
  intervalValue: 1,
  startsAt: new Date(2026, 0, 5, 12).toISOString(),
  nextRunDate: new Date(2026, 10, 5, 12).toISOString(),
  nextOccurrence: new Date(2026, 9, 5, 12).toISOString(),
  reminderDaysBefore: null,
  timezone: 'Europe/Kyiv',
  active: true,
  createdAt: new Date(2026, 0, 1).toISOString(),
  updatedAt: new Date(2026, 0, 1).toISOString(),
  ...overrides,
});

describe('toRecurringRuleBody', () => {
  it('starts the series on the chosen date, in the given zone', () => {
    const body = toRecurringRuleBody(values({ categoryId: 'rent', day: '2026-10-05', repeat: 'week:2' }), accounts, now, 'Europe/Kyiv');
    expect(body).toEqual({
      type: 'expense',
      amount: '10',
      currencyId: 1,
      accountId: usd.id,
      categoryId: 'rent',
      subcategoryId: null,
      toAccountId: null,
      note: null,
      percentage: null,
      percentageBase: null,
      intervalUnit: 'week',
      intervalValue: 2,
      // Local noon, as for a transaction dated on a day other than today.
      startsAt: new Date(2026, 9, 5, 12).toISOString(),
      timezone: 'Europe/Kyiv',
    });
  });

  it('carries a percentage, with the amount it comes to now', () => {
    const body = (overrides: Partial<TransactionFormValues>) =>
      toRecurringRuleBody(values({ repeat: 'month:1', amount: '350.00', ...overrides }), accounts, now, 'UTC');
    expect(body({ percentage: '3,5' })).toMatchObject({ amount: '350.00', percentage: '3.5', percentageBase: null });
    expect(body({ percentage: '5', percentageBase: '12 000,5' })).toMatchObject({ percentage: '5', percentageBase: '12000.5' });
    expect(body({ percentageBase: '12000' })).toMatchObject({ percentage: null, percentageBase: null });
  });

  it('starts one dated today right now, so its first transaction counts at once', () => {
    expect(toRecurringRuleBody(values({ repeat: 'month:1' }), accounts, now, 'UTC').startsAt).toBe(now.toISOString());
  });

  it('takes the place of the planned transaction it was, keeping its time of day', () => {
    const planned = { id: '00000000-0000-4000-8000-0000000000cc', date: new Date(2026, 9, 5, 8, 15).toISOString() };
    const body = toRecurringRuleBody(values({ day: '2026-10-05', repeat: 'month:1' }), accounts, now, 'UTC', planned);
    expect(body).toMatchObject({ startsAt: planned.date, replacesTransactionId: planned.id });
  });
});

describe('isPlannedDay', () => {
  it('counts from tomorrow on: today is already recorded, whatever the hour', () => {
    expect(isPlannedDay(new Date(2026, 8, 17, 23, 59).toISOString(), now)).toBe(false);
    expect(isPlannedDay(new Date(2026, 8, 16, 12).toISOString(), now)).toBe(false);
    expect(isPlannedDay(new Date(2026, 8, 18, 0, 0).toISOString(), now)).toBe(true);
  });
});

describe('isAhead', () => {
  it('goes by the clock: what is dated later today has still to happen', () => {
    expect(isAhead(new Date(2026, 8, 17, 23, 59).toISOString(), now)).toBe(true);
    expect(isAhead(new Date(2026, 8, 17, 15, 0).toISOString(), now)).toBe(false);
    expect(isAhead(null, now)).toBe(false);
  });
});

describe('isPlannedOccurrence', () => {
  const occurrence = (date: Date, overrides: { recurringRuleId?: string | null; scheduled?: Date } = {}) => ({
    date: date.toISOString(),
    recurringRuleId: overrides.recurringRuleId === undefined ? rule({}).id : overrides.recurringRuleId,
    recurrenceDate: (overrides.scheduled ?? date).toISOString(),
  });

  it('goes by the clock, not by the calendar, so that the API agrees', () => {
    expect(isPlannedOccurrence(occurrence(new Date(2026, 8, 17, 23, 59)), rule({}), now)).toBe(true);
    expect(isPlannedOccurrence(occurrence(new Date(2026, 8, 17, 15, 0)), rule({}), now)).toBe(false);
  });

  it('leaves out what no running series is waiting on', () => {
    // A one-off, and an occurrence whose series no longer runs — no rule is handed over for it.
    expect(isPlannedOccurrence(occurrence(new Date(2026, 9, 5, 12), { recurringRuleId: null }), rule({}), now)).toBe(false);
    expect(isPlannedOccurrence(occurrence(new Date(2026, 9, 5, 12)), undefined, now)).toBe(false);
  });

  it('leaves out one moved past its scheduled date: the series has written the next already', () => {
    const moved = occurrence(new Date(2026, 9, 20, 12), { scheduled: new Date(2026, 8, 5, 12) });
    expect(isPlannedOccurrence(moved, rule({}), now)).toBe(false);
  });
});

describe('plannedToRecurringRuleBody', () => {
  it("turns a planned one-off into the series that replaces it, as it is", () => {
    const planned = {
      id: '00000000-0000-4000-8000-0000000000dd',
      type: 'expense',
      date: new Date(2026, 9, 1, 12).toISOString(),
      amount: '42.00',
      currencyId: 1,
      accountId: usd.id,
      categoryId: 'phone',
      subcategoryId: null,
      toAccountId: null,
      note: 'SIM',
      percentage: '3.5',
      percentageBase: null,
    } as Transaction;
    expect(plannedToRecurringRuleBody(planned, { day: '2026-10-01', repeat: 'month:1' }, now, 'UTC')).toEqual({
      type: 'expense',
      amount: '42.00',
      currencyId: 1,
      accountId: usd.id,
      categoryId: 'phone',
      subcategoryId: null,
      toAccountId: null,
      note: 'SIM',
      percentage: '3.5',
      percentageBase: null,
      intervalUnit: 'month',
      intervalValue: 1,
      startsAt: planned.date,
      timezone: 'UTC',
      replacesTransactionId: planned.id,
    });
  });
});

describe('toRecurringRulePatch', () => {
  it("shows a series with its next date and how often it repeats", () => {
    expect(ruleToFormValues(rule({}))).toMatchObject({ day: '2026-10-05', repeat: 'month:1', amount: '9000.00', note: '' });
  });

  it('shows the percentage a series is worked out from', () => {
    expect(ruleToFormValues(rule({ percentage: '5', percentageBase: '12000.50' }))).toMatchObject({
      percentage: '5',
      percentageBase: '12000.50',
    });
    expect(ruleToFormValues(rule({ percentage: null, percentageBase: null }))).toMatchObject({ percentage: '', percentageBase: '' });
  });

  it('leaves the schedule alone when neither the next date nor the repeat changed', () => {
    const patch = toRecurringRulePatch({ ...ruleToFormValues(rule({})), amount: '9500' }, accounts, rule({}), now, 'UTC');
    expect(patch).toEqual({
      amount: '9500',
      currencyId: 1,
      accountId: usd.id,
      categoryId: 'rent',
      subcategoryId: null,
      toAccountId: null,
      note: null,
      percentage: null,
      percentageBase: null,
      intervalUnit: 'month',
      intervalValue: 1,
    });
  });

  it('starts the series afresh from a new next date', () => {
    const patch = toRecurringRulePatch({ ...ruleToFormValues(rule({})), day: '2026-10-07' }, accounts, rule({}), now, 'UTC');
    expect(patch).toMatchObject({ startsAt: new Date(2026, 9, 7, 12).toISOString(), timezone: 'UTC' });
  });

  it('keeps the next date, time and all, when only the repeat changes', () => {
    const patch = toRecurringRulePatch({ ...ruleToFormValues(rule({})), repeat: 'week:1' }, accounts, rule({}), now, 'UTC');
    expect(patch).toMatchObject({ intervalUnit: 'week', intervalValue: 1, startsAt: rule({}).nextOccurrence });
  });
});

describe('schedulePatch', () => {
  it("keeps the series' own repeat for no repeat, leaving how it stops to the caller", () => {
    expect(schedulePatch(rule({}), { day: '2026-10-05', repeat: '' }, now, 'UTC')).toEqual({ intervalUnit: 'month', intervalValue: 1 });
  });

  it('moves the start with the next date', () => {
    expect(schedulePatch(rule({}), { day: '2026-10-09', repeat: 'month:1' }, now, 'UTC')).toEqual({
      intervalUnit: 'month',
      intervalValue: 1,
      startsAt: new Date(2026, 9, 9, 12).toISOString(),
      timezone: 'UTC',
    });
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

describe('amountFromPercentage', () => {
  const card = { id: usd.id, balance: '-10000.00' };
  const worked = (percentage: string, percentageBase = '') => amountFromPercentage({ percentage, percentageBase }, card, undefined, now);

  it('takes the percentage of the base amount when there is one', () => {
    expect(worked('5', '12 000,50')).toBe('600.03');
  });

  it('takes it of the account balance otherwise', () => {
    expect(worked('3,5')).toBe('350.00');
    expect(amountFromPercentage({ percentage: '3', percentageBase: '' }, undefined, undefined, now)).toBeNull();
  });

  it('works nothing out from a wrong percentage or base amount', () => {
    expect(worked('')).toBeNull();
    expect(worked('150')).toBeNull();
    expect(worked('5', 'x')).toBeNull();
  });
});

describe('balanceBase', () => {
  const card = { id: usd.id, balance: '-1030.00' };
  const charge = {
    type: 'expense' as const,
    date: new Date(2026, 8, 1, 9).toISOString(),
    amount: '30.00',
    destAmount: null,
    accountId: usd.id,
    toAccountId: null,
  } satisfies Partial<Transaction>;

  it('is the balance as it is for a new transaction', () => {
    expect(balanceBase(card, undefined, now)).toBe('-1030.00');
  });

  it('leaves out what the transaction being edited took from the account', () => {
    expect(balanceBase(card, charge, now)).toBe('-1000.00');
    expect(balanceBase(card, { ...charge, type: 'transfer', toAccountId: usd2.id }, now)).toBe('-1000.00');
  });

  it('leaves out what it brought in', () => {
    expect(balanceBase({ id: usd.id, balance: '530.00' }, { ...charge, type: 'income' }, now)).toBe('500.00');
    const arrived = { ...charge, type: 'transfer' as const, accountId: eur.id, toAccountId: usd.id, destAmount: '32.10' };
    expect(balanceBase({ id: usd.id, balance: '532.10' }, arrived, now)).toBe('500.00');
  });

  it('takes nothing off for a transaction the balance does not hold yet, or holds elsewhere', () => {
    expect(balanceBase(card, { ...charge, date: new Date(2026, 9, 1).toISOString() }, now)).toBe('-1030.00');
    expect(balanceBase({ id: usd2.id, balance: '80.00' }, charge, now)).toBe('80.00');
  });
});
