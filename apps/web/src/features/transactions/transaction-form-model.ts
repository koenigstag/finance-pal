import { z } from 'zod';
import { TRANSACTION_TYPES, isRoundBalanceStep, type RoundBalanceStep } from '@ft/shared-contracts';
import { deviceTimezone, fromDayInput, toDayInput, todayInput } from '@/lib/dates';
import type { Conversion } from '@/features/currencies/rates';
import {
  convertMoney,
  isValidAmountInput,
  parseMoneyInput,
  parsePercentageInput,
  percentOf,
  roundBalanceAmount,
  sumMoney,
} from '@/lib/money';
import type { RecurringRule, RecurringRuleBody, RecurringRulePatch, Transaction, TransactionBody } from './queries';
import { parseRepeatKey, repeatOf, toRepeatKey } from './repeat';

interface AccountLike {
  id: string;
  currencyId: number;
}

/**
 * How the app converts from one currency to another, by their ids, or null when it has no rate for
 * the pair. Handed in by whoever knows the rates (see conversionBetween); the model only reads it.
 */
export type ConversionLookup = (fromCurrencyId: number, toCurrencyId: number) => Conversion | null;

/**
 * The account a new transaction starts on: the one asked for (e.g. the account the list is
 * filtered by) if it exists, otherwise the favourite, otherwise the first regular account (the top
 * of the accounts page, which lists regular accounts first), otherwise the first at all. Without a
 * request this is also the account the UI shows as favourite, starred or not. Accounts come in list
 * order, so should several ever be marked, the first one listed wins.
 */
export function pickDefaultAccountId(
  accounts: (AccountLike & { isFavourite: boolean; type?: string })[],
  requestedId?: string,
): string | undefined {
  const requested = requestedId ? accounts.find((account) => account.id === requestedId) : undefined;
  return (
    requested ??
    accounts.find((account) => account.isFavourite) ??
    accounts.find((account) => account.type === 'regular') ??
    accounts[0]
  )?.id;
}

// What the inputs hold: strings as typed, '' for "nothing chosen". Converted to the contract's
// body only on submit, by toTransactionBody.
export interface TransactionFormValues {
  type: (typeof TRANSACTION_TYPES)[number];
  amount: string;
  accountId: string;
  toAccountId: string;
  destAmount: string;
  categoryId: string;
  // One of categoryId's subcategories; cleared whenever the category changes.
  subcategoryId: string;
  day: string;
  // Per cent, when the amount is worked out from it; '' when the amount is typed.
  percentage: string;
  // What the percentage is of; '' for the account's balance.
  percentageBase: string;
  // Instead of a percentage: the step ("100") the amount rounds the account's balance to; '' for none.
  roundBalanceTo: string;
  note: string;
  // How often it repeats, as toRepeatKey writes it; '' for a one-off transaction.
  repeat: string;
}

// The figures the Amount sheet edits, and the sides that decide which of them a transaction needs.
export type AmountValues = Pick<
  TransactionFormValues,
  'amount' | 'destAmount' | 'percentage' | 'percentageBase' | 'roundBalanceTo'
>;
export type TransactionSides = Pick<TransactionFormValues, 'type' | 'accountId' | 'toAccountId'>;

export interface TransactionFormMessages {
  required: string;
  amount: string;
  sameAccount: string;
  repeatCurrency: string;
  pastNextDate: string;
  percentage: string;
  // The amount a valid percentage came to is nothing: what it's of is zero or too small for it.
  percentageAmount: string;
  // Rounding the balance comes to nothing: it's on a multiple of the step already.
  roundBalanceAmount: string;
}

export interface TransactionFormContext {
  // Editing a series: the next date it had when the form opened. It may stay as it is, but a new
  // one can't be in the past — a changed schedule applies from today on, so nothing would be
  // written for it.
  seriesNextDay?: string;
  today?: string;
  // Without it, what arrives across currencies has to be typed, as before rates were fetched.
  conversionOf?: ConversionLookup;
}

type AmountMessages = Pick<TransactionFormMessages, 'amount' | 'percentage' | 'percentageAmount' | 'roundBalanceAmount'>;

/** A transfer between accounts in different currencies records what arrived, too. */
export function needsDestAmount(values: TransactionSides, accounts: AccountLike[]): boolean {
  if (values.type !== 'transfer' || !values.accountId || !values.toAccountId) {
    return false;
  }
  const from = accounts.find((account) => account.id === values.accountId);
  const to = accounts.find((account) => account.id === values.toAccountId);
  return !!from && !!to && from.currencyId !== to.currencyId;
}

/**
 * How a transfer between these accounts converts what it sends into what arrives: null when it
 * doesn't cross currencies, or when the app has no rate for the pair and what arrives must be typed.
 */
export function transferConversion(
  values: TransactionSides,
  accounts: AccountLike[],
  conversionOf: ConversionLookup | undefined,
): Conversion | null {
  if (!conversionOf || !needsDestAmount(values, accounts)) {
    return null;
  }
  const from = accounts.find((account) => account.id === values.accountId) as AccountLike;
  const to = accounts.find((account) => account.id === values.toAccountId) as AccountLike;
  return conversionOf(from.currencyId, to.currencyId);
}

// What's wrong with the amounts, for the form and the Amount sheet alike. Worked out from a
// percentage or by rounding the balance, the amount isn't typed: what can be wrong then is the
// percentage, the base amount it's of, or else what they came to. A base amount without a
// percentage isn't used, so it isn't checked either.
//
// `scheduled`: dated ahead or repeating. Then an amount from the balance is only what it comes to
// as things stand, worked out again until its date, so nothing for now is no mistake.
//
// What arrives across currencies is typed only to override the rate: left empty, it's converted,
// so it's only missing when there's no rate to convert by.
function checkAmounts(
  values: AmountValues & TransactionSides,
  accounts: AccountLike[],
  messages: AmountMessages,
  scheduled: boolean,
  conversion: Conversion | null,
  ctx: z.RefinementCtx,
) {
  const percentage = values.percentage.trim() ? parsePercentageInput(values.percentage) : undefined;
  const step = percentage ? null : parseRoundBalanceTo(values.roundBalanceTo);
  const fromBalance = (percentage && !values.percentageBase.trim()) || step;
  if (percentage === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percentage'], message: messages.percentage });
  } else if (percentage && values.percentageBase.trim() && !isValidAmountInput(values.percentageBase)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['percentageBase'], message: messages.amount });
  } else if (!isValidAmountInput(values.amount) && !(scheduled && fromBalance && parseMoneyInput(values.amount) !== null)) {
    const message = percentage ? messages.percentageAmount : step ? messages.roundBalanceAmount : messages.amount;
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message });
  }
  const typedDest = values.destAmount.trim();
  if (needsDestAmount(values, accounts) && (typedDest ? !isValidAmountInput(typedDest) : !conversion)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destAmount'], message: messages.amount });
  }
}

// The API rejects the same things (see its TransactionValidator); checking here puts the message
// next to the field instead of behind a generic error.
export function transactionFormSchema(
  accounts: AccountLike[],
  messages: TransactionFormMessages,
  context: TransactionFormContext = {},
) {
  return z
    .object({
      type: z.enum(TRANSACTION_TYPES),
      amount: z.string(),
      accountId: z.string().min(1, messages.required),
      toAccountId: z.string(),
      destAmount: z.string(),
      categoryId: z.string(),
      subcategoryId: z.string(),
      day: z.string().min(1, messages.required),
      percentage: z.string(),
      percentageBase: z.string(),
      roundBalanceTo: z.string(),
      note: z.string().max(1000),
      repeat: z.string(),
    })
    .superRefine((values, ctx) => {
      const { seriesNextDay, today = todayInput(), conversionOf } = context;
      const conversion = transferConversion(values, accounts, conversionOf);
      // Dates as yyyy-MM-dd compare as text.
      checkAmounts(values, accounts, messages, !!values.repeat || values.day > today, conversion, ctx);
      if (values.type === 'transfer') {
        if (!values.toAccountId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toAccountId'], message: messages.required });
        } else if (values.toAccountId === values.accountId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toAccountId'], message: messages.sameAccount });
        }
        // A series converts each occurrence on its day, and only the API can do that: it needs
        // rates fetched for both currencies, not ones typed by hand, which only the app has.
        if (values.repeat && needsDestAmount(values, accounts) && !conversion?.fetched) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['repeat'], message: messages.repeatCurrency });
        }
      }
      if (seriesNextDay !== undefined && values.day !== seriesNextDay && values.day < today) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['day'], message: messages.pastNextDate });
      }
    });
}

/**
 * The Amount sheet's figures, checked for a transaction with these sides — and, `scheduled`, dated
 * ahead or repeating (see checkAmounts).
 */
export function amountFormSchema(
  sides: TransactionSides,
  accounts: AccountLike[],
  messages: AmountMessages,
  scheduled = false,
  conversion: Conversion | null = null,
) {
  return z
    .object({
      amount: z.string(),
      destAmount: z.string(),
      percentage: z.string(),
      percentageBase: z.string(),
      roundBalanceTo: z.string(),
    })
    .superRefine((values, ctx) => checkAmounts({ ...values, ...sides }, accounts, messages, scheduled, conversion, ctx));
}

// Amounts start at "0" rather than empty, so the field always shows a number; the inputs select
// their content on focus, so typing replaces the zero instead of appending to it.
const EMPTY_AMOUNT = '0';
// Except what arrives across currencies: empty there means "at the rate", whose figure the field
// shows in its place, and a zero would read as nothing arriving.
const AT_THE_RATE = '';

export function defaultTransactionFormValues(defaults: {
  accountId?: string;
  toAccountId?: string;
  type?: TransactionFormValues['type'];
  now?: Date;
}): TransactionFormValues {
  return {
    type: defaults.type ?? 'expense',
    amount: EMPTY_AMOUNT,
    accountId: defaults.accountId ?? '',
    toAccountId: defaults.toAccountId ?? '',
    destAmount: AT_THE_RATE,
    categoryId: '',
    subcategoryId: '',
    day: todayInput(defaults.now),
    percentage: '',
    percentageBase: '',
    roundBalanceTo: '',
    note: '',
    repeat: '',
  };
}

export function transactionToFormValues(transaction: Transaction): TransactionFormValues {
  return {
    type: transaction.type,
    amount: transaction.amount,
    accountId: transaction.accountId,
    toAccountId: transaction.toAccountId ?? '',
    // A figure converted at a rate isn't shown as typed: saved untouched, it stays the API's to keep,
    // or to follow the rate while it's planned.
    destAmount: transaction.destAmountAsOf === null ? (transaction.destAmount ?? AT_THE_RATE) : AT_THE_RATE,
    categoryId: transaction.categoryId ?? '',
    subcategoryId: transaction.subcategoryId ?? '',
    day: toDayInput(transaction.date),
    percentage: transaction.percentage ?? '',
    percentageBase: transaction.percentageBase ?? '',
    roundBalanceTo: transaction.roundBalanceTo ? String(transaction.roundBalanceTo) : '',
    note: transaction.note ?? '',
    repeat: '',
  };
}

/**
 * Whether a transaction is still to come by the calendar: dated tomorrow or later. That decides what
 * editing it means — one recorded today or before changes alone; a planned occurrence changes its
 * series from there on, which leaves what's already recorded as it is.
 */
export function isPlannedDay(iso: string, now = new Date()): boolean {
  return toDayInput(iso) > todayInput(now);
}

/**
 * Whether a transaction hasn't happened yet, by the clock rather than the calendar: dated later
 * today counts as still to come, as it does for the API and for the list's planned half. What
 * came from a series is only marked as such while it's still ahead; once it's recorded it's a
 * transaction like any other.
 */
export function isAhead(iso: string | null, now = new Date()): boolean {
  return iso !== null && new Date(iso).getTime() > now.getTime();
}

/**
 * Whether a transaction is the occurrence its series is waiting on: one of a series still running,
 * with its date and the date it was scheduled for both still ahead — by the clock rather than the
 * calendar, as the API reads it too (see its plannedOccurrence). That one stands for the series'
 * next date, so it alone can be recorded early or skipped, and either way the series carries on
 * with the date after it.
 */
export function isPlannedOccurrence(
  transaction: Pick<Transaction, 'date' | 'recurringRuleId' | 'recurrenceDate'>,
  rule: Pick<RecurringRule, 'id'> | undefined,
  now = new Date(),
): boolean {
  return (
    !!rule &&
    transaction.recurringRuleId === rule.id &&
    isAhead(transaction.date, now) &&
    isAhead(transaction.recurrenceDate, now)
  );
}

// The date a series' form shows: when it next produces a transaction.
export function nextDateOf(rule: RecurringRule): string {
  return rule.nextOccurrence ?? rule.startsAt;
}

/** A series as its form shows it: the next date for the date, and how often it repeats. */
export function ruleToFormValues(rule: RecurringRule): TransactionFormValues {
  return {
    type: rule.type,
    amount: rule.amount,
    accountId: rule.accountId,
    toAccountId: rule.toAccountId ?? '',
    destAmount: AT_THE_RATE,
    categoryId: rule.categoryId ?? '',
    subcategoryId: rule.subcategoryId ?? '',
    day: toDayInput(nextDateOf(rule)),
    percentage: rule.percentage ?? '',
    percentageBase: rule.percentageBase ?? '',
    roundBalanceTo: rule.roundBalanceTo ? String(rule.roundBalanceTo) : '',
    note: rule.note ?? '',
    repeat: toRepeatKey(repeatOf(rule)),
  };
}

/**
 * The request body for validated form values. Fields that don't apply to the type are sent as
 * null rather than left out, so switching an existing expense to a transfer (or back) clears
 * what no longer belongs instead of the API keeping the old value.
 */
export function toTransactionBody(
  values: TransactionFormValues,
  accounts: AccountLike[],
  // What arrives stays out of an edit it was converted for; see destAmountFor.
  existing?: Pick<Transaction, 'date'> & Partial<Pick<Transaction, 'destAmountAsOf'>>,
  now = new Date(),
  conversionOf?: ConversionLookup,
): TransactionBody {
  const account = accounts.find((candidate) => candidate.id === values.accountId);
  if (!account) {
    throw new Error(`Unknown account ${values.accountId}`);
  }
  const isTransfer = values.type === 'transfer';
  const percentage = parsePercentageInput(values.percentage);
  const note = values.note.trim();

  return {
    type: values.type,
    date: fromDayInput(values.day, existing?.date, now),
    amount: requireMoney(values.amount),
    // A transaction is recorded in its source account's currency.
    currencyId: account.currencyId,
    accountId: account.id,
    categoryId: isTransfer ? null : values.categoryId || null,
    // Only ever with its category: on its own it would say nothing the API could file.
    subcategoryId: isTransfer || !values.categoryId ? null : values.subcategoryId || null,
    toAccountId: isTransfer ? values.toAccountId : null,
    destAmount: destAmountFor(values, accounts, existing, conversionOf),
    // Null, not left out, once cleared: an edit keeps what it doesn't mention.
    percentage,
    // Only ever with its percentage, which without one is of the account's balance.
    percentageBase: percentage && values.percentageBase.trim() ? requireMoney(values.percentageBase) : null,
    // Never beside a percentage; null clears it, as for the percentage.
    roundBalanceTo: percentage ? null : parseRoundBalanceTo(values.roundBalanceTo),
    // The API can't set a note to null; an empty string is how an edit clears it.
    note: note || (existing ? '' : undefined),
  };
}

/**
 * The request body starting a series with the form's values: the date is its first occurrence,
 * scheduled in the device's time zone. A date in the past is recorded, together with every one
 * since, and the series goes on from there. Given a planned transaction, the series takes its place.
 */
export function toRecurringRuleBody(
  values: TransactionFormValues,
  accounts: AccountLike[],
  now = new Date(),
  timezone = deviceTimezone(),
  replaces?: Pick<Transaction, 'id' | 'date'>,
): RecurringRuleBody {
  const repeat = parseRepeatKey(values.repeat);
  if (!repeat) {
    throw new Error(`Invalid repeat ${values.repeat}`);
  }
  return {
    type: values.type,
    ...seriesTemplate(values, accounts),
    intervalUnit: repeat.unit,
    intervalValue: repeat.value,
    // A planned transaction keeps its time of day when it stays on its day.
    startsAt: fromDayInput(values.day, replaces?.date, now),
    timezone,
    ...(replaces ? { replacesTransactionId: replaces.id } : {}),
  };
}

/**
 * The request body changing a series: what each of its transactions will be, and its schedule
 * (see schedulePatch).
 */
export function toRecurringRulePatch(
  values: TransactionFormValues,
  accounts: AccountLike[],
  rule: RecurringRule,
  now = new Date(),
  timezone = deviceTimezone(),
): RecurringRulePatch {
  return { ...seriesTemplate(values, accounts), ...schedulePatch(rule, values, now, timezone) };
}

/**
 * A series' schedule after a new next date or repeat. Its start is only sent when either changed:
 * the series then starts afresh from that date, which becomes its first occurrence, so "every
 * month" from a new next date keeps to that date's day. No repeat ('') keeps the series' own: how
 * a series stops is up to the caller.
 */
export function schedulePatch(
  rule: RecurringRule,
  choice: Pick<TransactionFormValues, 'day' | 'repeat'>,
  now = new Date(),
  timezone = deviceTimezone(),
): RecurringRulePatch {
  const repeat = parseRepeatKey(choice.repeat) ?? repeatOf(rule);
  const rescheduled = choice.day !== toDayInput(nextDateOf(rule)) || toRepeatKey(repeat) !== toRepeatKey(repeatOf(rule));
  return {
    intervalUnit: repeat.unit,
    intervalValue: repeat.value,
    ...(rescheduled ? { startsAt: fromDayInput(choice.day, nextDateOf(rule), now), timezone } : {}),
  };
}

/** A planned one-off transaction as the series that takes its place, repeating as chosen. */
export function plannedToRecurringRuleBody(
  transaction: Transaction,
  choice: Pick<TransactionFormValues, 'day' | 'repeat'>,
  now = new Date(),
  timezone = deviceTimezone(),
): RecurringRuleBody {
  const repeat = parseRepeatKey(choice.repeat);
  if (!repeat) {
    throw new Error(`Invalid repeat ${choice.repeat}`);
  }
  return {
    type: transaction.type,
    amount: transaction.amount,
    currencyId: transaction.currencyId,
    accountId: transaction.accountId,
    categoryId: transaction.categoryId,
    subcategoryId: transaction.subcategoryId,
    toAccountId: transaction.toAccountId,
    note: transaction.note,
    percentage: transaction.percentage,
    percentageBase: transaction.percentageBase,
    roundBalanceTo: transaction.roundBalanceTo,
    intervalUnit: repeat.unit,
    intervalValue: repeat.value,
    startsAt: fromDayInput(choice.day, transaction.date, now),
    timezone,
    replacesTransactionId: transaction.id,
  };
}

// What each of a series' transactions will be. As in toTransactionBody, fields that don't apply to
// the type go as null, and a series has no received amount (see transactionFormSchema). With a
// percentage or a rounding, the amount is what it comes to now; each occurrence works it out afresh.
function seriesTemplate(values: TransactionFormValues, accounts: AccountLike[]) {
  const account = accounts.find((candidate) => candidate.id === values.accountId);
  if (!account) {
    throw new Error(`Unknown account ${values.accountId}`);
  }
  const isTransfer = values.type === 'transfer';
  const percentage = parsePercentageInput(values.percentage);
  return {
    percentage,
    percentageBase: percentage && values.percentageBase.trim() ? requireMoney(values.percentageBase) : null,
    roundBalanceTo: percentage ? null : parseRoundBalanceTo(values.roundBalanceTo),
    amount: requireMoney(values.amount),
    currencyId: account.currencyId,
    accountId: account.id,
    categoryId: isTransfer ? null : values.categoryId || null,
    subcategoryId: isTransfer || !values.categoryId ? null : values.subcategoryId || null,
    toAccountId: isTransfer ? values.toAccountId : null,
    // Unlike a transaction's, a series' note can be cleared with null.
    note: values.note.trim() || null,
  };
}

// What of a saved transaction moves money, and when.
type Contribution = Pick<Transaction, 'type' | 'date' | 'amount' | 'destAmount' | 'accountId' | 'toAccountId'>;

interface BalanceLike {
  id: string;
  balance: string;
}

/** The step a form field holds ("100"), or null for none or anything that isn't one. */
export function parseRoundBalanceTo(value: string): RoundBalanceStep | null {
  const step = Number(value);
  return value !== '' && isRoundBalanceStep(step) ? step : null;
}

/**
 * The amount the form's figures work out to: a percentage of the base amount when one is typed,
 * otherwise of the account's balance as balanceBase has it; or, rounding the balance, whatever
 * leaves it on a multiple of the step once the transaction goes through: down for money going out,
 * up for an income. Null until there's something valid to work it out from.
 */
export function derivedAmount(
  values: Pick<AmountValues, 'percentage' | 'percentageBase' | 'roundBalanceTo'>,
  type: TransactionFormValues['type'],
  account: BalanceLike | undefined,
  editing?: Contribution,
  now = new Date(),
): string | null {
  const percentage = parsePercentageInput(values.percentage);
  if (percentage) {
    const base = values.percentageBase.trim()
      ? parseMoneyInput(values.percentageBase)
      : account
        ? balanceBase(account, editing, now)
        : null;
    return base !== null ? percentOf(base, percentage) : null;
  }
  const step = parseRoundBalanceTo(values.roundBalanceTo);
  return step && account ? roundBalanceAmount(balanceBase(account, editing, now), step, type === 'income' ? 'in' : 'out') : null;
}

/**
 * The balance a percentage without a base amount is taken of, or a rounding rounds: the account's
 * current one, less what the transaction being edited has already put into it — worked out afresh,
 * a charge mustn't count itself. A future-dated transaction isn't in the current balance yet, so
 * then nothing comes off.
 */
export function balanceBase(account: BalanceLike, editing?: Contribution, now = new Date()): string {
  if (!editing || new Date(editing.date) > now) {
    return account.balance;
  }
  // The reverse of what the database's transaction_balance_contribution() adds for it.
  if (editing.accountId === account.id) {
    return sumMoney([account.balance, editing.type === 'income' ? `-${editing.amount}` : editing.amount]);
  }
  if (editing.type === 'transfer' && editing.toAccountId === account.id) {
    return sumMoney([account.balance, `-${editing.destAmount ?? editing.amount}`]);
  }
  return account.balance;
}

/**
 * What a transfer sends as received. A figure typed stands, and no rate overrides it. Otherwise it's
 * converted: by the API for a pair whose rates were fetched — null asks it to, and on an edit of an
 * amount it converted, leaving it out lets it keep that, or follow the rate while it's planned — and
 * by the app for a pair only the user's own rates cover, which the API has no rate for.
 */
function destAmountFor(
  values: TransactionFormValues,
  accounts: AccountLike[],
  existing: Partial<Pick<Transaction, 'destAmountAsOf'>> | undefined,
  conversionOf: ConversionLookup | undefined,
): string | null | undefined {
  if (!needsDestAmount(values, accounts)) {
    return null;
  }
  if (isValidAmountInput(values.destAmount)) {
    return requireMoney(values.destAmount);
  }
  const conversion = transferConversion(values, accounts, conversionOf);
  if (conversion && !conversion.fetched) {
    const figure = convertMoney(requireMoney(values.amount), conversion.rate);
    return isValidAmountInput(figure) ? figure : null;
  }
  return existing?.destAmountAsOf ? undefined : null;
}

function requireMoney(input: string): string {
  const amount = parseMoneyInput(input);
  if (amount === null) {
    throw new Error(`Invalid amount ${input}`);
  }
  return amount;
}
