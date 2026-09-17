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
import { useAccountUsage, useDeleteAccount, type Account } from './queries';

interface DeleteAccountDialogProps {
  groupId: string;
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

/**
 * Confirms deleting an account, spelling out what goes with it: its transactions (planned ones
 * counted apart) and the recurring rules using it, as counted by the API right before asking.
 */
export function DeleteAccountDialog({ groupId, account, open, onOpenChange, onDeleted }: DeleteAccountDialogProps) {
  const { t } = useTranslation();
  const usage = useAccountUsage(groupId, account.id, open);
  const deleteAccount = useDeleteAccount(groupId);

  const consequences: string[] = [];
  if (usage.data) {
    const { transactionCount, plannedTransactionCount, recurringRuleCount } = usage.data;
    if (transactionCount > 0) {
      consequences.push(t('accounts.delete.transactions', { count: transactionCount }));
    }
    if (plannedTransactionCount > 0) {
      consequences.push(t('accounts.delete.plannedTransactions', { count: plannedTransactionCount }));
    }
    if (recurringRuleCount > 0) {
      consequences.push(t('accounts.delete.recurringRules', { count: recurringRuleCount }));
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleteAccount.isPending) {
          deleteAccount.reset();
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('accounts.delete.title', { name: account.name })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {usage.isPending ? (
                <Spinner className="size-5" />
              ) : usage.isError ? (
                <span>{t('errors.generic')}</span>
              ) : consequences.length === 0 ? (
                <span>{t('accounts.delete.empty')}</span>
              ) : (
                <>
                  <span>{t('accounts.delete.alsoDeletes')}</span>
                  <ul className="list-disc pl-5">
                    {consequences.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {usage.data.transactionCount + usage.data.plannedTransactionCount > 0 && (
                    <span>{t('accounts.delete.transfersNote')}</span>
                  )}
                </>
              )}
              <span>{t('accounts.delete.irreversible')}</span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteAccount.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteAccount.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            // Not before the counts are in: the point of the dialog is to see them first.
            disabled={!usage.isSuccess || deleteAccount.isPending}
            onClick={(event) => {
              // Stay open until the request settles, to show its failure here.
              event.preventDefault();
              deleteAccount.mutate(account.id, {
                onSuccess: () => {
                  onOpenChange(false);
                  onDeleted();
                },
              });
            }}
          >
            {deleteAccount.isPending && <Spinner />}
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
