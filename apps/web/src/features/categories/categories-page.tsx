import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  GripVerticalIcon,
  PlusIcon,
  ShapesIcon,
  XIcon,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { CATEGORY_TYPES } from '@ft/shared-contracts';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { PAGE_BOTTOM_SPACE, PageHeader } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useGroupScope } from '@/features/groups/group-context';
import { useDragReorder, type ReorderHandleProps } from '@/lib/drag-reorder';
import { useSwipeTrack } from '@/lib/swipe';
import { cn } from '@/lib/utils';
import { CategoryActionsSheet, type CategoryAction } from './category-actions-sheet';
import { CategoryDialog } from './category-dialog';
import { buildTree, move, moveSubcategory, orderedIds, type CategoryTree } from './category-order';
import { useCategories, useReorderCategories, type Category } from './queries';

type CategoryType = Category['type'];

// Same order as the transaction type picker: income first.
const TYPE_ORDER = ['income', 'expense'] as const satisfies readonly (typeof CATEGORY_TYPES)[number][];

// The arrows the transaction form uses for the same two things: money in, money out.
const TYPE_ICONS: Record<CategoryType, LucideIcon> = { income: ArrowUpIcon, expense: ArrowDownIcon };

interface DialogState {
  open: boolean;
  category?: Category;
}

export function CategoriesPage() {
  const { t } = useTranslation();
  const { group, ability } = useGroupScope();
  const categories = useCategories(group.id);
  const reorder = useReorderCategories(group.id);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [sheet, setSheet] = useState<{ open: boolean; category?: Category }>({ open: false });
  // Parents whose subcategories are showing; each list starts folded away under its parent.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // The list as it is being rearranged, kept apart from the fetched one until it is saved — so a
  // refetch never moves a row out from under a finger. Null while the page is only being read,
  // which is what says whether the list is in reorder mode at all.
  const [draft, setDraft] = useState<CategoryTree[] | null>(null);
  const toggle = (categoryId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(categoryId)) {
        next.add(categoryId);
      }
      return next;
    });

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

  // A tree per tab rather than just the one on screen: the other is rendered while the strip is
  // being dragged, and both come out of the categories already fetched.
  const trees = useMemo(
    () => Object.fromEntries(TYPE_ORDER.map((option) => [option, buildTree(categories.data ?? [], option)])),
    [categories.data],
  ) as Record<CategoryType, CategoryTree[]>;

  // Income and expense side by side, in the order the picker lists them: dragging the strip left
  // moves to the next along, right to the one before, and a drag towards nothing gives a little
  // and comes back.
  const typeIndex = TYPE_ORDER.indexOf(type);
  const strip = useSwipeTrack({
    count: TYPE_ORDER.length,
    index: typeIndex,
    position: type,
    onCommit: (delta) => setParams({ type: TYPE_ORDER[typeIndex + delta] }, { replace: true }),
  });

  // The tab on screen, as it stands: a reorder is one tab's, which is why the tabs are held while
  // one is under way.
  const startReordering = () => {
    reorder.reset();
    setDraft(trees[type]);
  };
  const stopReordering = () => {
    reorder.reset();
    setDraft(null);
  };
  const saveOrder = async () => {
    // A second ✓ while the first is still in flight would send the same order twice.
    if (!draft || reorder.isPending) {
      return;
    }
    try {
      await reorder.mutateAsync(orderedIds(draft));
      setDraft(null);
    } catch {
      // Said by the alert above the list; the draft stays, so the ✓ can simply be pressed again.
    }
  };

  const tabContent = (option: CategoryType) => {
    if (trees[option].length === 0) {
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShapesIcon />
            </EmptyMedia>
            <EmptyTitle>{t('categories.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('categories.empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }
    return (
      <ul className="divide-y rounded-xl border">
        {trees[option].map(({ category, children }) => {
          const isExpanded = children.length > 0 && expanded.has(category.id);
          const listId = `subcategories-${category.id}`;
          return (
            <li key={category.id}>
              <div className="flex">
                <CategoryRow
                  category={category}
                  detail={children.length > 0 ? t('categories.subcategoryCount', { count: children.length }) : undefined}
                  onSelect={() => setSheet({ open: true, category })}
                  className="flex-1"
                />
                {/* Its own button: the row itself opens the category's actions, as every row does. */}
                {children.length > 0 && (
                  <ExpandButton
                    expanded={isExpanded}
                    listId={listId}
                    label={t('categories.subcategoriesOf', { name: category.name })}
                    onClick={() => toggle(category.id)}
                  />
                )}
              </div>
              {isExpanded && (
                <ul id={listId} className="divide-y border-t">
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
          );
        })}
      </ul>
    );
  };

  return (
    <section className={cn('flex flex-1 flex-col gap-4', PAGE_BOTTOM_SPACE)}>
      <PageHeader
        title={t('categories.title')}
        // Saving the new order is what the page is for while it is being rearranged, so the ✓
        // takes the + 's place — on a phone, that puts it under the thumb however far down the
        // list the last row was dragged.
        action={
          draft
            ? { label: t('categories.reorder.save'), icon: CheckIcon, onClick: () => void saveOrder() }
            : canCreate
              ? { label: t('categories.new'), icon: PlusIcon, onClick: () => setDialog({ open: true }) }
              : undefined
        }
      >
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            className="min-w-0 flex-1 md:w-80 md:flex-none"
            value={type}
            // Held while a reorder is under way: the draft is this tab's, and switching away
            // would be a change nobody asked to throw out.
            disabled={draft !== null}
            onValueChange={(value) => {
              if (value) {
                setParams({ type: value }, { replace: true });
              }
            }}
          >
            {TYPE_ORDER.map((option) => {
              const Icon = TYPE_ICONS[option];
              return (
                <ToggleGroupItem key={option} value={option} className="flex-1">
                  <Icon />
                  {t(`categories.types.${option}`)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
          {canUpdate &&
            (draft ? (
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label={t('common.cancel')}
                disabled={reorder.isPending}
                onClick={stopReordering}
              >
                <XIcon />
              </Button>
            ) : (
              trees[type].length > 0 && (
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  aria-label={t('categories.reorder.start')}
                  onClick={startReordering}
                >
                  <ArrowUpDownIcon />
                </Button>
              )
            ))}
        </div>
      </PageHeader>

      {draft && (
        <>
          {reorder.isError && (
            <Alert variant="destructive">
              <AlertDescription>{t('errors.generic')}</AlertDescription>
            </Alert>
          )}
          <p className="text-sm text-muted-foreground">{t('categories.reorder.hint')}</p>
        </>
      )}

      {categories.isPending ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : categories.isError ? (
        <QueryError onRetry={() => void categories.refetch()} />
      ) : draft ? (
        // No strip while rearranging: the tabs are held anyway, and a swipe across the page is
        // one gesture too many next to rows being dragged up and down it.
        <CategoryReorderList
          tree={draft}
          expanded={expanded}
          onToggle={toggle}
          onMove={(from, to) => setDraft((current) => (current ? move(current, from, to) : current))}
          onMoveSubcategory={(parentId, from, to) =>
            setDraft((current) => (current ? moveSubcategory(current, parentId, from, to) : current))
          }
        />
      ) : (
        /*
          The two lists side by side, clipped to the one on screen. The negative margin pays for
          the padding inside each, so the rows stay as wide as the page while a gutter opens
          between them as the strip is dragged across, and the strip takes what is left of the
          screen so a short list can still be swiped off. Only the list on screen is rendered while
          the strip is still, so the shorter of the two doesn't scroll the page to the length of
          the longer.
        */
        <div {...strip.viewport} className="-mx-2 flex-1 overflow-hidden">
          <div style={strip.track} className="flex w-full items-start">
            {TYPE_ORDER.map((option) => (
              // A list waiting off to the side is to be seen, not read out or tabbed into.
              <div key={option} inert={option !== type} className="w-full shrink-0 px-2">
                {(option === type || strip.active) && tabContent(option)}
              </div>
            ))}
          </div>
        </div>
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

interface CategoryReorderListProps {
  tree: CategoryTree[];
  expanded: ReadonlySet<string>;
  onToggle: (categoryId: string) => void;
  onMove: (from: number, to: number) => void;
  onMoveSubcategory: (parentId: string, from: number, to: number) => void;
}

/**
 * The same list, with each row taken by its grip instead of opening anything. A parent moves with
 * its subcategories, since they travel inside its row; a subcategory moves among the subcategories
 * of the parent it is under. Nothing changes levels here — moving a category under another parent
 * re-files its transactions, which is the edit dialog's job, not a drag's.
 */
function CategoryReorderList({ tree, expanded, onToggle, onMove, onMoveSubcategory }: CategoryReorderListProps) {
  const { t } = useTranslation();
  const reorder = useDragReorder(tree.length, onMove);

  return (
    <ul className="divide-y rounded-xl border">
      {tree.map(({ category, children }, index) => {
        const isExpanded = children.length > 0 && expanded.has(category.id);
        const listId = `subcategories-${category.id}`;
        return (
          <li
            key={category.id}
            {...reorder.row(index)}
            // Only the row being carried paints a background — over the rows it passes, and
            // without squaring off the corners of the list it sits in.
            className={cn(reorder.dragging === index && 'rounded-xl bg-background shadow-lg ring-1 ring-border')}
          >
            <div className="flex">
              <ReorderGrip {...reorder.handle(index)} label={t('categories.reorder.move', { name: category.name })} />
              <CategoryRow
                category={category}
                detail={children.length > 0 ? t('categories.subcategoryCount', { count: children.length }) : undefined}
                className="flex-1"
              />
              {children.length > 0 && (
                <ExpandButton
                  expanded={isExpanded}
                  listId={listId}
                  label={t('categories.subcategoriesOf', { name: category.name })}
                  onClick={() => onToggle(category.id)}
                />
              )}
            </div>
            {isExpanded && (
              <SubcategoryReorderList
                listId={listId}
                subcategories={children}
                onMove={(from, to) => onMoveSubcategory(category.id, from, to)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface SubcategoryReorderListProps {
  listId: string;
  subcategories: Category[];
  onMove: (from: number, to: number) => void;
}

function SubcategoryReorderList({ listId, subcategories, onMove }: SubcategoryReorderListProps) {
  const { t } = useTranslation();
  const reorder = useDragReorder(subcategories.length, onMove);

  return (
    <ul id={listId} className="divide-y border-t">
      {subcategories.map((subcategory, index) => (
        <li
          key={subcategory.id}
          {...reorder.row(index)}
          className={cn('flex', reorder.dragging === index && 'rounded-xl bg-background shadow-lg ring-1 ring-border')}
        >
          <ReorderGrip {...reorder.handle(index)} label={t('categories.reorder.move', { name: subcategory.name })} />
          <CategoryRow category={subcategory} nested className="flex-1" />
        </li>
      ))}
    </ul>
  );
}

interface ReorderGripProps extends ReorderHandleProps {
  label: string;
}

/** What a row is dragged by — and, for a keyboard, what moves it with the up and down arrows. */
function ReorderGrip({ label, ...handle }: ReorderGripProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex w-12 shrink-0 cursor-grab items-center justify-center text-muted-foreground hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none active:cursor-grabbing"
      {...handle}
    >
      <GripVerticalIcon className="size-4" />
    </button>
  );
}

interface ExpandButtonProps {
  expanded: boolean;
  listId: string;
  label: string;
  onClick: () => void;
}

function ExpandButton({ expanded, listId, label, onClick }: ExpandButtonProps) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={listId}
      aria-label={label}
      className="flex w-12 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted/50"
      onClick={onClick}
    >
      <ChevronDownIcon className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
    </button>
  );
}

interface CategoryRowProps {
  category: Category;
  nested?: boolean;
  detail?: string;
  // What opening the row does, where it opens anything: a row being rearranged is only read.
  onSelect?: () => void;
  className?: string;
}

function CategoryRow({ category, nested = false, detail, onSelect, className }: CategoryRowProps) {
  // Subcategories line their smaller icon up under the parent's name.
  const layout = cn(
    'flex min-h-12 w-full min-w-0 items-center gap-3 px-4 py-2 text-left',
    nested && 'pl-[3.75rem]',
    className,
  );
  const content = (
    <>
      <AppearanceIcon icon={category.icon} color={category.color} size={nested ? 'sm' : 'md'} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate', nested ? 'text-sm' : 'font-medium')}>{category.name}</p>
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
    </>
  );

  return onSelect ? (
    <button type="button" className={cn(layout, 'hover:bg-muted/50')} onClick={onSelect}>
      {content}
    </button>
  ) : (
    <div className={layout}>{content}</div>
  );
}
