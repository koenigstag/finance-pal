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
import { targetName, type BudgetLineRow } from './budget-model';
import { useDeleteBudget } from './queries';

interface RemoveBudgetDialogProps {
  groupId: string;
  row?: BudgetLineRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Confirms taking a line out of this month's budget; other months and the transactions stay. */
export function RemoveBudgetDialog({ groupId, row, open, onOpenChange }: RemoveBudgetDialogProps) {
  const { t } = useTranslation();
  const remove = useDeleteBudget(groupId);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!remove.isPending) {
          remove.reset();
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{row && t('budget.remove.title', { name: targetName(row.target) })}</AlertDialogTitle>
          <AlertDialogDescription>{t('budget.remove.description')}</AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!row || remove.isPending}
            onClick={(event) => {
              // Stay open until the request settles, to show its failure here.
              event.preventDefault();
              if (row) {
                remove.mutate(row.line.id, { onSuccess: () => onOpenChange(false) });
              }
            }}
          >
            {remove.isPending && <Spinner />}
            {t('budget.remove.action')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
