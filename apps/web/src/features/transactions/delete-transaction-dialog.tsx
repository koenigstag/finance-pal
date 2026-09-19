import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Spinner } from '@/components/ui/spinner';
import { useDeleteRecurringRule, useDeleteTransaction, type RecurringRule, type Transaction } from './queries';
import { isPlannedOccurrence } from './transaction-form-model';

interface DeleteTransactionDialogProps {
  groupId: string;
  transaction?: Transaction;
  // The series it's an occurrence of, while that one runs.
  rule?: RecurringRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirms deleting a transaction, and what "deleting" reaches follows from the row, as it does
 * for editing one: anything already recorded goes on its own, an occurrence of a series included —
 * only that date is skipped. Delete on the occurrence a running series is waiting on is the
 * series': it stops repeating and the planned transaction goes with it, while what it has already
 * recorded stays. (Skip is there for the single date, and the Date sheet's "never" ends a series
 * with its planned transaction kept.)
 */
export function DeleteTransactionDialog({ groupId, transaction, rule, open, onOpenChange }: DeleteTransactionDialogProps) {
  const { t } = useTranslation();
  const deleteTransaction = useDeleteTransaction(groupId);
  const deleteRule = useDeleteRecurringRule(groupId);
  const series = transaction && isPlannedOccurrence(transaction, rule) ? rule : undefined;
  const mutation = series ? deleteRule : deleteTransaction;

  const run = () => {
    if (!transaction) {
      return;
    }
    const settled = { onSuccess: () => onOpenChange(false) };
    if (series) {
      deleteRule.mutate({ ruleId: series.id }, settled);
    } else {
      deleteTransaction.mutate(transaction.id, settled);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) {
          mutation.reset();
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(series ? 'transactions.deleteConfirm.seriesTitle' : 'transactions.deleteConfirm.title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              series
                ? 'transactions.deleteConfirm.series'
                : transaction?.recurringRuleId
                  ? 'transactions.deleteConfirm.occurrence'
                  : 'transactions.deleteConfirm.description',
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!transaction || mutation.isPending}
            onClick={(event) => {
              // Stay open until the request settles, to show its failure here.
              event.preventDefault();
              run();
            }}
          >
            {mutation.isPending && <Spinner />}
            {t(series ? 'transactions.actions.deleteSeries' : 'common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
