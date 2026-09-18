import { z } from 'zod';
import { TRANSACTION_TYPES } from '@ft/shared-contracts';
import { fromDayInput, toDayInput, todayInput } from '@/lib/dates';
import { isValidAmountInput, parseMoneyInput } from '@/lib/money';
import type { Transaction, TransactionBody } from './queries';

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
  day: string;
  note: string;
}

export interface TransactionFormMessages {
  required: string;
  amount: string;
  sameAccount: string;
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
export function transactionFormSchema(accounts: AccountLike[], messages: TransactionFormMessages) {
  return z
    .object({
      type: z.enum(TRANSACTION_TYPES),
      amount: z.string(),
      accountId: z.string().min(1, messages.required),
      toAccountId: z.string(),
      destAmount: z.string(),
      categoryId: z.string(),
      day: z.string().min(1, messages.required),
      note: z.string().max(1000),
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
    day: todayInput(defaults.now),
    note: '',
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
    day: toDayInput(transaction.date),
    note: transaction.note ?? '',
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
    toAccountId: isTransfer ? values.toAccountId : null,
    destAmount: needsDestAmount(values, accounts) ? requireMoney(values.destAmount) : null,
    // The API can't set a note to null; an empty string is how an edit clears it.
    note: note || (existing ? '' : undefined),
  };
}

function requireMoney(input: string): string {
  const amount = parseMoneyInput(input);
  if (amount === null) {
    throw new Error(`Invalid amount ${input}`);
  }
  return amount;
}
