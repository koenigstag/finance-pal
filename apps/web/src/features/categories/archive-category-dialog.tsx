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
import { useSetCategoryArchived, type Category } from './queries';

interface ArchiveCategoryDialogProps {
  groupId: string;
  // Which way it goes follows the category: an archived one is there to be restored.
  category: Category;
  // How many subcategories travel with it, for the sentence that says they do.
  subcategoryCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirms putting a category away, or taking one back out, saying what changes either way.
 * Nothing filed under it is touched, so neither direction is spelled out the way deleting is — but
 * archiving takes the category out of the lists and the pickers, and carries its subcategories
 * along, which is worth saying before it happens.
 */
export function ArchiveCategoryDialog({
  groupId,
  category,
  subcategoryCount,
  open,
  onOpenChange,
}: ArchiveCategoryDialogProps) {
  const { t } = useTranslation();
  const setArchived = useSetCategoryArchived(groupId);
  const key = category.archived ? 'restore' : 'archive';

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
          <AlertDialogTitle>{t(`categories.${key}.title`, { name: category.name })}</AlertDialogTitle>
          <AlertDialogDescription>{t(`categories.${key}.description`)}</AlertDialogDescription>
        </AlertDialogHeader>
        {subcategoryCount > 0 && (
          <p className="text-sm text-muted-foreground">
            {t(`categories.${key}.subcategories`, { count: subcategoryCount })}
          </p>
        )}
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
                { categoryId: category.id, archived: !category.archived },
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            {setArchived.isPending && <Spinner />}
            {t(`categories.${key}.action`)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
