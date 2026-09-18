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
import { useCategoryUsage, useDeleteCategory, type Category } from './queries';

interface DeleteCategoryDialogProps {
  groupId: string;
  category: Category;
  // The category it's a subcategory of, if it is one.
  parent?: Category;
  subcategories: Category[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

/**
 * Confirms deleting a category: its subcategories go with it, while the transactions and recurring
 * rules filed under any of them stay — without a category, or, for a subcategory, in its parent
 * without a subcategory. The API counts them right before asking.
 */
export function DeleteCategoryDialog({
  groupId,
  category,
  parent,
  subcategories,
  open,
  onOpenChange,
  onDeleted,
}: DeleteCategoryDialogProps) {
  const { t } = useTranslation();
  const usage = useCategoryUsage(groupId, category.id, open);
  const deleteCategory = useDeleteCategory(groupId);

  const affected: string[] = [];
  if (usage.data) {
    const { transactionCount, plannedTransactionCount, recurringRuleCount } = usage.data;
    if (transactionCount > 0) {
      affected.push(t('categories.delete.transactions', { count: transactionCount }));
    }
    if (plannedTransactionCount > 0) {
      affected.push(t('categories.delete.plannedTransactions', { count: plannedTransactionCount }));
    }
    if (recurringRuleCount > 0) {
      affected.push(t('categories.delete.recurringRules', { count: recurringRuleCount }));
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!deleteCategory.isPending) {
          deleteCategory.reset();
          onOpenChange(next);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('categories.delete.title', { name: category.name })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              {subcategories.length > 0 && (
                <span>
                  {t('categories.delete.subcategories', {
                    count: subcategories.length,
                    names: subcategories.map((subcategory) => subcategory.name).join(', '),
                  })}
                </span>
              )}
              {usage.isPending ? (
                <Spinner className="size-5" />
              ) : usage.isError ? (
                <span>{t('errors.generic')}</span>
              ) : affected.length === 0 ? (
                <span>{t('categories.delete.unused')}</span>
              ) : (
                <>
                  <span>
                    {parent
                      ? t('categories.delete.willStayInParent', { name: parent.name })
                      : t('categories.delete.willBeUncategorized')}
                  </span>
                  <ul className="list-disc pl-5">
                    {affected.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <span>{t('categories.delete.moneyKept')}</span>
                </>
              )}
              <span>{t('categories.delete.irreversible')}</span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteCategory.isError && (
          <Alert variant="destructive">
            <AlertDescription>{t('errors.generic')}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteCategory.isPending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            // Not before the counts are in: the point of the dialog is to see them first.
            disabled={!usage.isSuccess || deleteCategory.isPending}
            onClick={(event) => {
              // Stay open until the request settles, to show its failure here.
              event.preventDefault();
              deleteCategory.mutate(category.id, {
                onSuccess: () => {
                  onOpenChange(false);
                  onDeleted();
                },
              });
            }}
          >
            {deleteCategory.isPending && <Spinner />}
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
