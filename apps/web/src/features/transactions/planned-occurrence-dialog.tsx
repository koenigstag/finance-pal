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
import { useDeleteTransaction, useSaveTransaction, type Transaction } from './queries';

/** What a series' planned occurrence can be told to do: happen now, or not at all. */
export type PlannedOccurrenceAction = 'add-now' | 'skip';

interface PlannedOccurrenceDialogProps {
  groupId: string;
  // The planned occurrence the action is for.
  transaction?: Transaction;
  action: PlannedOccurrenceAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirms what happens to the occurrence a series is waiting on, and carries it out.
 *
 * Add now dates it this moment, so an early payment counts towards the balances at once; Skip
 * removes it, and that date is passed over for good — the series never writes it again. Either way
 * the series is left with nothing planned and writes its next occurrence, which takes this one's
 * place in the list. The schedule itself stays as it is: moving a series on is the Date action.
 */
export function PlannedOccurrenceDialog({ groupId, transaction, action, open, onOpenChange }: PlannedOccurrenceDialogProps) {
  const { t } = useTranslation();
  const saveTransaction = useSaveTransaction(groupId);
  const deleteTransaction = useDeleteTransaction(groupId);
  const skipping = action === 'skip';
  const mutation = skipping ? deleteTransaction : saveTransaction;
  // The action's own label does for its button too, as Delete's does in the delete dialog.
  const confirmLabel = t(skipping ? 'transactions.actions.skip' : 'transactions.actions.addNow');

  const run = () => {
    if (!transaction) {
      return;
    }
    const settled = { onSuccess: () => onOpenChange(false) };
    if (skipping) {
      deleteTransaction.mutate(transaction.id, settled);
    } else {
      // Dated now, which is what makes the API count it as having happened.
      saveTransaction.mutate({ transactionId: transaction.id, body: { date: new Date().toISOString() } }, settled);
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
          <AlertDialogTitle>{t(skipping ? 'transactions.skipConfirm.title' : 'transactions.addNowConfirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(skipping ? 'transactions.skipConfirm.description' : 'transactions.addNowConfirm.description')}
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
            disabled={!transaction || mutation.isPending}
            onClick={(event) => {
              // Stay open until the request settles, to show its failure here.
              event.preventDefault();
              run();
            }}
          >
            {mutation.isPending && <Spinner />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
