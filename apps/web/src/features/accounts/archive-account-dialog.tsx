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
import { useSetAccountArchived, type Account } from './queries';

interface ArchiveAccountDialogProps {
  groupId: string;
  // Which way it goes follows the account: an archived one is there to be restored.
  account: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirms archiving an account, or restoring an archived one, saying what changes either way.
 * Nothing recorded on the account is touched, so neither direction is spelled out the way deleting
 * is — but archiving takes the account out of the lists, the pickers and the total, which is worth
 * one sentence before it happens.
 */
export function ArchiveAccountDialog({ groupId, account, open, onOpenChange }: ArchiveAccountDialogProps) {
  const { t } = useTranslation();
  const setArchived = useSetAccountArchived(groupId);
  const key = account.archived ? 'restore' : 'archive';

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!setArchived.isPending) {
          setArchived.reset();
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`accounts.${key}.title`, { name: account.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t(`accounts.${key}.description`)}</AlertDialogDescription>
        </AlertDialogHeader>
        {setArchived.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={setArchived.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            disabled={setArchived.isPending}
            onClick={(event) => {
              // Stay open until the request settles, to show its failure here.
              event.preventDefault();
              setArchived.mutate(
                { accountId: account.id, archived: !account.archived },
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            {setArchived.isPending && <Spinner />}
            {t(`accounts.${key}.action`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
