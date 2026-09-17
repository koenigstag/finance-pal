import { PlusIcon, ShapesIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { CATEGORY_TYPES } from '@ft/shared-contracts';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { PAGE_BOTTOM_SPACE, PageHeader } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useGroupScope } from '@/features/groups/group-context';
import { cn } from '@/lib/utils';
import { CategoryActionsSheet, type CategoryAction } from './category-actions-sheet';
import { CategoryDialog } from './category-dialog';
import { useCategories, type Category } from './queries';

type CategoryType = Category['type'];

// Same order as the transaction type picker: income first.
const TYPE_ORDER = ['income', 'expense'] as const satisfies readonly (typeof CATEGORY_TYPES)[number][];

interface DialogState {
  open: boolean;
  category?: Category;
}

export function CategoriesPage() {
  const { t } = useTranslation();
  const { group, ability } = useGroupScope();
  const categories = useCategories(group.id);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [sheet, setSheet] = useState<{ open: boolean; category?: Category }>({ open: false });

  // In the URL, so a reload or the back button returns to the same list. Expense by default:
  // it's the list people edit most.
  const type: CategoryType = params.get('type') === 'income' ? 'income' : 'expense';
  const canCreate = ability.can('create', 'Category');
  const canUpdate = ability.can('update', 'Category');
  const canDelete = ability.can('delete', 'Category');

  const onAction = (action: CategoryAction, category: Category) => {
    setSheet((current) => ({ ...current, open: false }));
    if (action === 'edit') {
      setDialog({ open: true, category });
    } else {
      void navigate(`/g/${group.id}/transactions?category=${category.id}`);
    }
  };

  const tree = useMemo(() => buildTree(categories.data ?? [], type), [categories.data, type]);

  return (
    <section className={cn('flex flex-col gap-4', PAGE_BOTTOM_SPACE)}>
      <PageHeader
        title={t('categories.title')}
        action={canCreate ? { label: t('categories.new'), icon: PlusIcon, onClick: () => setDialog({ open: true }) } : undefined}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full md:w-80"
          value={type}
          onValueChange={(value) => {
            if (value) {
              setParams({ type: value }, { replace: true });
            }
          }}
        >
          {TYPE_ORDER.map((option) => (
            <ToggleGroupItem key={option} value={option} className="flex-1">
              {t(`categories.types.${option}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PageHeader>


      {categories.isPending ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : categories.isError ? (
        <QueryError onRetry={() => void categories.refetch()} />
      ) : tree.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShapesIcon />
            </EmptyMedia>
            <EmptyTitle>{t('categories.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('categories.empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y rounded-xl border">
          {tree.map(({ category, children }) => (
            <li key={category.id}>
              <CategoryRow
                category={category}
                detail={children.length > 0 ? t('categories.subcategoryCount', { count: children.length }) : undefined}
                onSelect={() => setSheet({ open: true, category })}
              />
              {children.length > 0 && (
                <ul className="divide-y border-t">
                  {children.map((child) => (
                    <li key={child.id}>
                      <CategoryRow
                        category={child}
                        nested
                        onSelect={() => setSheet({ open: true, category: child })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <CategoryActionsSheet
        category={sheet.category}
        parent={categories.data?.find((candidate) => candidate.id === sheet.category?.parentId)}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        canEdit={canUpdate}
        onAction={onAction}
      />

      <CategoryDialog
        groupId={group.id}
        categories={categories.data ?? []}
        type={dialog.category?.type ?? type}
        category={dialog.category}
        canDelete={canDelete}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />
    </section>
  );
}

interface CategoryRowProps {
  category: Category;
  nested?: boolean;
  detail?: string;
  onSelect: () => void;
}

function CategoryRow({ category, nested = false, detail, onSelect }: CategoryRowProps) {
  return (
    <button
      type="button"
      // Subcategories line their smaller icon up under the parent's name.
      className={cn('flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/50', nested && 'pl-[3.75rem]')}
      onClick={onSelect}
    >
      <AppearanceIcon icon={category.icon} color={category.color} size={nested ? 'sm' : 'md'} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate', nested ? 'text-sm' : 'font-medium')}>{category.name}</p>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
    </button>
  );
}

interface TreeNode {
  category: Category;
  children: Category[];
}

// Two levels, as the API enforces. A subcategory whose parent isn't in the list (archived, or a
// leftover of another type) is shown at the top level rather than hidden.
function buildTree(categories: Category[], type: CategoryType): TreeNode[] {
  const byOrder = (a: Category, b: Category) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const ofType = categories.filter((category) => category.type === type);
  const topLevelIds = new Set(ofType.filter((category) => category.parentId === null).map((category) => category.id));
  return ofType
    .filter((category) => category.parentId === null || !topLevelIds.has(category.parentId))
    .sort(byOrder)
    .map((category) => ({
      category,
      children: ofType.filter((child) => child.parentId === category.id).sort(byOrder),
    }));
}
