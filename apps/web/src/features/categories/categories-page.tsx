import { ChevronRightIcon, PlusIcon, ShapesIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { CATEGORY_TYPES } from '@ft/shared-contracts';
import { PageHeader } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useGroupScope } from '@/features/groups/group-context';
import { cn } from '@/lib/utils';
import { CategoryDialog } from './category-dialog';
import { useCategories, type Category } from './queries';

type CategoryType = Category['type'];

// Same order as the transaction type picker: income first.
const TYPE_ORDER = ['income', 'expense'] as const satisfies readonly (typeof CATEGORY_TYPES)[number][];

interface DialogState {
  open: boolean;
  category?: Category;
  defaultParentId?: string;
}

export function CategoriesPage() {
  const { t } = useTranslation();
  const { group, ability } = useGroupScope();
  const categories = useCategories(group.id);
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<DialogState>({ open: false });

  // In the URL, so a reload or the back button returns to the same list. Expense by default:
  // it's the list people edit most.
  const type: CategoryType = params.get('type') === 'income' ? 'income' : 'expense';
  const canCreate = ability.can('create', 'Category');
  const canUpdate = ability.can('update', 'Category');
  const canDelete = ability.can('delete', 'Category');

  const tree = useMemo(() => buildTree(categories.data ?? [], type), [categories.data, type]);

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={t('categories.title')}
        action={canCreate ? { label: t('categories.new'), icon: PlusIcon, onClick: () => setDialog({ open: true }) } : undefined}
      />

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
                onSelect={canUpdate ? () => setDialog({ open: true, category }) : undefined}
                onAddSubcategory={
                  canCreate ? () => setDialog({ open: true, defaultParentId: category.id }) : undefined
                }
              />
              {children.length > 0 && (
                <ul className="divide-y border-t">
                  {children.map((child) => (
                    <li key={child.id}>
                      <CategoryRow
                        category={child}
                        nested
                        onSelect={canUpdate ? () => setDialog({ open: true, category: child }) : undefined}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <CategoryDialog
        groupId={group.id}
        categories={categories.data ?? []}
        type={dialog.category?.type ?? type}
        category={dialog.category}
        defaultParentId={dialog.defaultParentId}
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
  // Absent for callers who can't edit: the row is then plain text.
  onSelect?: () => void;
  onAddSubcategory?: () => void;
}

function CategoryRow({ category, nested = false, detail, onSelect, onAddSubcategory }: CategoryRowProps) {
  const { t } = useTranslation();
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate', nested ? 'text-sm' : 'font-medium')}>{category.name}</p>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
      {onSelect && <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const rowClass = cn('flex min-h-12 flex-1 items-center gap-3 px-4 py-2 text-left', nested && 'pl-10');

  return (
    <div className="flex items-center pr-2">
      {onSelect ? (
        <button type="button" className={cn(rowClass, 'hover:bg-muted/50')} onClick={onSelect}>
          {content}
        </button>
      ) : (
        <div className={rowClass}>{content}</div>
      )}
      {onAddSubcategory && (
        <Button variant="ghost" size="icon" aria-label={t('categories.addSubcategory', { name: category.name })} onClick={onAddSubcategory}>
          <PlusIcon />
        </Button>
      )}
    </div>
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
