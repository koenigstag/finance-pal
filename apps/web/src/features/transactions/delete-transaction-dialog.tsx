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
import { useDeleteTransaction, type Transaction } from './queries';

interface DeleteTransactionDialogProps {
  groupId: string;
  transaction?: Transaction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Confirms deleting a transaction; for an occurrence of a recurring series, only that date goes. */
export function DeleteTransactionDialog({ groupId, transaction, open, onOpenChange }: DeleteTransactionDialogProps) {
  const { t } = useTranslation();
  const deleteTransaction = useDeleteTransaction(groupId);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleteTransaction.isPending) {
          deleteTransaction.reset();
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('transactions.deleteConfirm.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(transaction?.recurringRuleId ? 'transactions.deleteConfirm.occurrence' : 'transactions.deleteConfirm.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteTransaction.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteTransaction.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!transaction || deleteTransaction.isPending}
            onClick={(event) => {
              // Stay open until the request settles, to show its failure here.
              event.preventDefault();
              if (transaction) {
                deleteTransaction.mutate(transaction.id, {
                  onSuccess: () => onOpenChange(false),
                });
              }
            }}
          >
            {deleteTransaction.isPending && <Spinner />}
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
