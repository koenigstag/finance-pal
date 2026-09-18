import { ChevronRightIcon, PencilIcon, ReceiptTextIcon, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Category } from './queries';

export type CategoryAction = 'edit' | 'transactions';

interface CategoryActionsSheetProps {
  category?: Category;
  // The category's parent, for a subcategory.
  parent?: Category;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Whether the caller may edit categories; Edit is left out otherwise.
  canEdit: boolean;
  onAction: (action: CategoryAction, category: Category) => void;
}

/**
 * What can be done with a category, opened by tapping its row: a bottom sheet on phones (the
 * dialog's small-screen layout), a dialog from sm up.
 */
export function CategoryActionsSheet({ category, parent, open, onOpenChange, canEdit, onAction }: CategoryActionsSheetProps) {
  const { t } = useTranslation();

  const actions: { action: CategoryAction; label: string; icon: LucideIcon }[] = [];
  if (canEdit) {
    actions.push({ action: 'edit', label: t('common.edit'), icon: PencilIcon });
  }
  actions.push({ action: 'transactions', label: t('nav.transactions'), icon: ReceiptTextIcon });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {category && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 pr-8">
                <AppearanceIcon icon={category.icon} color={category.color} size="lg" />
                <div className="min-w-0 flex-1 text-left">
                  <DialogTitle className="truncate">{category.name}</DialogTitle>
                  <DialogDescription className="truncate">{t(`categories.types.${category.type}`)}</DialogDescription>
                  {parent && <p className="truncate text-sm text-muted-foreground">{parent.name}</p>}
                </div>
              </div>
            </DialogHeader>
            <ul className="-mx-2 flex flex-col">
              {actions.map(({ action, label, icon: Icon }) => (
                <li key={action}>
                  <button
                    type="button"
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => onAction(action, category)}
                  >
                    <span className="flex size-8 items-center justify-center rounded-full bg-muted [&_svg]:size-4">
                      <Icon />
                    </span>
                    <span className="flex-1 font-medium">{label}</span>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
