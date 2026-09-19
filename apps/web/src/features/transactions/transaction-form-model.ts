import { z } from 'zod';
import { TRANSACTION_TYPES } from '@ft/shared-contracts';
import { deviceTimezone, fromDayInput, toDayInput, todayInput } from '@/lib/dates';
import { isValidAmountInput, parseMoneyInput } from '@/lib/money';
import type { RecurringRule, RecurringRuleBody, RecurringRulePatch, Transaction, TransactionBody } from './queries';
import { parseRepeatKey, repeatOf, toRepeatKey } from './repeat';

interface AccountLike {
  id: string;
  currencyId: number;
}

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
  note: string;
  // How often it repeats, as toRepeatKey writes it; '' for a one-off transaction.
  repeat: string;
}

export interface TransactionFormMessages {
  required: string;
  amount: string;
  sameAccount: string;
  repeatCurrency: string;
  pastNextDate: string;
}

export interface TransactionFormContext {
  // Editing a series: the next date it had when the form opened. It may stay as it is, but a new
  // one can't be in the past — a changed schedule applies from today on, so nothing would be
  // written for it.
  seriesNextDay?: string;
  today?: string;
}

/** A transfer between accounts in different currencies records what arrived, too. */
export function needsDestAmount(values: Pick<TransactionFormValues, 'type' | 'accountId' | 'toAccountId'>, accounts: AccountLike[]): boolean {
  if (values.type !== 'transfer' || !values.accountId || !values.toAccountId) {
    return false;
  }
  const from = accounts.find((account) => account.id === values.accountId);
  const to = accounts.find((account) => account.id === values.toAccountId);
  return !!from && !!to && from.currencyId !== to.currencyId;
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
      note: z.string().max(1000),
      repeat: z.string(),
    })
    .superRefine((values, ctx) => {
      if (!isValidAmountInput(values.amount)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: messages.amount });
      }
      if (values.type === 'transfer') {
        if (!values.toAccountId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toAccountId'], message: messages.required });
        } else if (values.toAccountId === values.accountId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['toAccountId'], message: messages.sameAccount });
        }
        if (needsDestAmount(values, accounts) && !isValidAmountInput(values.destAmount)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['destAmount'], message: messages.amount });
        }
        // A series carries one amount for both sides, which only holds within one currency.
        if (values.repeat && needsDestAmount(values, accounts)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['repeat'], message: messages.repeatCurrency });
        }
      }
      const { seriesNextDay, today = todayInput() } = context;
      // Dates as yyyy-MM-dd compare as text.
      if (seriesNextDay !== undefined && values.day !== seriesNextDay && values.day < today) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['day'], message: messages.pastNextDate });
      }
    });
}

// Amounts start at "0" rather than empty, so the field always shows a number; the inputs select
// their content on focus, so typing replaces the zero instead of appending to it.
const EMPTY_AMOUNT = '0';

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
    destAmount: EMPTY_AMOUNT,
    categoryId: '',
    subcategoryId: '',
    day: todayInput(defaults.now),
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
    destAmount: transaction.destAmount ?? EMPTY_AMOUNT,
    categoryId: transaction.categoryId ?? '',
    subcategoryId: transaction.subcategoryId ?? '',
    day: toDayInput(transaction.date),
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
  const ahead = (iso: string | null) => iso !== null && new Date(iso).getTime() > now.getTime();
  return !!rule && transaction.recurringRuleId === rule.id && ahead(transaction.date) && ahead(transaction.recurrenceDate);
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
    destAmount: EMPTY_AMOUNT,
    categoryId: rule.categoryId ?? '',
    subcategoryId: rule.subcategoryId ?? '',
    day: toDayInput(nextDateOf(rule)),
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
  existing?: Pick<Transaction, 'date'>,
  now = new Date(),
): TransactionBody {
  const account = accounts.find((candidate) => candidate.id === values.accountId);
  if (!account) {
    throw new Error(`Unknown account ${values.accountId}`);
  }
  const isTransfer = values.type === 'transfer';
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
    destAmount: needsDestAmount(values, accounts) ? requireMoney(values.destAmount) : null,
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
    intervalUnit: repeat.unit,
    intervalValue: repeat.value,
    startsAt: fromDayInput(choice.day, transaction.date, now),
    timezone,
    replacesTransactionId: transaction.id,
  };
}

// What each of a series' transactions will be. As in toTransactionBody, fields that don't apply to
// the type go as null, and a series has no received amount (see transactionFormSchema).
function seriesTemplate(values: TransactionFormValues, accounts: AccountLike[]) {
  const account = accounts.find((candidate) => candidate.id === values.accountId);
  if (!account) {
    throw new Error(`Unknown account ${values.accountId}`);
  }
  const isTransfer = values.type === 'transfer';
  return {
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

function requireMoney(input: string): string {
  const amount = parseMoneyInput(input);
  if (amount === null) {
    throw new Error(`Invalid amount ${input}`);
  }
  return amount;
}
