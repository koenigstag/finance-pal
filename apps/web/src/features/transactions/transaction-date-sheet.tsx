import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Account } from '@/features/accounts/queries';
import { useGroupScope } from '@/features/groups/group-context';
import { fromDayInput, toDayInput, todayInput } from '@/lib/dates';
import { DateSheet, type DateChoice } from './date-sheet';
import { useDeleteRecurringRule, useSaveRecurringRule, useSaveTransaction, type RecurringRule, type Transaction } from './queries';
import { repeatOf, toRepeatKey } from './repeat';
import { isPlannedDay, nextDateOf, plannedToRecurringRuleBody, schedulePatch } from './transaction-form-model';

interface TransactionDateSheetProps {
  groupId: string;
  transaction?: Transaction;
  // The series it's an occurrence of, while that one runs.
  rule?: RecurringRule;
  accounts: Account[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * A transaction's Date action: when it happens, and how often, saved as soon as the sheet is done.
 *
 * A transaction recorded today or before just moves. A planned occurrence moves its series — from
 * there on, what's recorded stays as it is — and repeating "never" ends the series with it, kept as
 * a one-off. A planned one-off can start repeating, and becomes a series.
 */
export function TransactionDateSheet({ groupId, transaction, rule, accounts, open, onOpenChange }: TransactionDateSheetProps) {
  const { t } = useTranslation();
  const { ability } = useGroupScope();
  const saveTransaction = useSaveTransaction(groupId);
  const saveRule = useSaveRecurringRule(groupId);
  const deleteRule = useDeleteRecurringRule(groupId);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) {
      setFailed(false);
    }
  }, [open]);

  const planned = !!transaction && isPlannedDay(transaction.date);
  const series = planned ? rule : undefined;
  const value: DateChoice = series
    ? { day: toDayInput(nextDateOf(series)), repeat: toRepeatKey(repeatOf(series)) }
    : { day: transaction ? toDayInput(transaction.date) : '', repeat: '' };
  // A one-off still to come can start repeating; an occurrence of a series that no longer runs
  // can't be taken over by a new one.
  const canStartSeries =
    planned &&
    !transaction?.recurringRuleId &&
    ability.can('create', 'RecurringRule') &&
    ability.can('delete', 'Transaction');
  const currencyOf = (id: string | null) => accounts.find((account) => account.id === id)?.currencyId;
  const acrossCurrencies =
    transaction?.type === 'transfer' && currencyOf(transaction.accountId) !== currencyOf(transaction.toAccountId);

  const onDone = async (choice: DateChoice) => {
    if (!transaction) {
      return;
    }
    setPending(true);
    setFailed(false);
    try {
      if (series) {
        const patch = schedulePatch(series, choice);
        const rescheduled =
          patch.startsAt !== undefined || patch.intervalUnit !== series.intervalUnit || patch.intervalValue !== series.intervalValue;
        if (rescheduled) {
          await saveRule.mutateAsync({ ruleId: series.id, body: patch });
        }
        if (!choice.repeat) {
          await deleteRule.mutateAsync({ ruleId: series.id, keepPlanned: true });
        }
      } else if (choice.repeat) {
        await saveRule.mutateAsync({ body: plannedToRecurringRuleBody(transaction, choice) });
      } else if (choice.day !== value.day) {
        await saveTransaction.mutateAsync({
          transactionId: transaction.id,
          body: { date: fromDayInput(choice.day, transaction.date) },
        });
      }
      onOpenChange(false);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <DateSheet
      open={open}
      onOpenChange={(next) => !pending && onOpenChange(next)}
      title={t(series ? 'transactions.nextDate' : 'transactions.date')}
      value={value}
      canRepeat={!!series || canStartSeries}
      repeatBlocked={!series && acrossCurrencies ? t('transactions.errors.repeatCurrency') : undefined}
      currentRepeat={series ? repeatOf(series) : null}
      // A series moves on from today: its next date can't be in the past.
      minDay={series ? todayInput() : undefined}
      pending={pending}
      error={failed ? t('errors.generic') : undefined}
      onDone={(choice) => void onDone(choice)}
    />
  );
}
