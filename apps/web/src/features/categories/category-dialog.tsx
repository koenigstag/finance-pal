import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ColorPicker, IconPicker } from './appearance-picker';
import { defaultAppearance } from './category-appearance';
import { CategoryIcon } from './category-icon';
import { DeleteCategoryDialog } from './delete-category-dialog';
import { nextSortOrder, useSaveCategory, type Category } from './queries';

// Radix Select can't hold an empty value, so "no parent" needs a stand-in.
const TOP_LEVEL = 'top';

const categoryFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

interface CategoryDialogProps {
  groupId: string;
  // Every category of the group, for the parent picker and sibling ordering.
  categories: Category[];
  type: Category['type'];
  // The category to edit; absent to create one.
  category?: Category;
  // Preselected parent for a new category, e.g. from a parent's "add subcategory" button.
  defaultParentId?: string;
  canDelete?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CategoryDialog({
  groupId,
  categories,
  type,
  category,
  defaultParentId,
  canDelete = false,
  open,
  onOpenChange,
}: CategoryDialogProps) {
  const { t } = useTranslation();
  const saveCategory = useSaveCategory(groupId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const form = useForm<CategoryFormValues>({ resolver: zodResolver(categoryFormSchema) });
  const errors = form.formState.errors;

  // Categories are two levels deep: parents are top-level categories of the same type, and one
  // that has subcategories of its own can't become a subcategory.
  const parentOptions = useMemo(
    () =>
      categories
        .filter((candidate) => candidate.type === type && candidate.parentId === null && candidate.id !== category?.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [categories, type, category?.id],
  );
  const subcategories = category ? categories.filter((candidate) => candidate.parentId === category.id) : [];
  const canHaveParent = subcategories.length === 0;
  const [previewName, previewIcon, previewColor] = useWatch({ control: form.control, name: ['name', 'icon', 'color'] });

  useEffect(() => {
    if (open) {
      const parentId = category?.parentId ?? defaultParentId ?? null;
      // A new category starts from its parent's look, or the next color of the palette.
      const suggested = defaultAppearance(
        categories.find((candidate) => candidate.id === parentId),
        categories.filter((candidate) => candidate.type === type && candidate.parentId === parentId).length,
      );
      form.reset({
        name: category?.name ?? '',
        parentId: parentId ?? TOP_LEVEL,
        icon: category ? category.icon : suggested.icon,
        color: category ? category.color : suggested.color,
      });
    }
    // Only on opening: the categories list refetching must not overwrite a pick in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category, defaultParentId, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    const parentId = values.parentId === TOP_LEVEL ? null : values.parentId;
    // A category that moves (or a new one) goes to the end of its new siblings.
    const sortOrder =
      category && category.parentId === parentId ? undefined : nextSortOrder(categories, type, parentId);
    const appearance = { icon: values.icon, color: values.color };
    try {
      await (category
        ? saveCategory.mutateAsync({ categoryId: category.id, body: { name: values.name, parentId, sortOrder, ...appearance } })
        : saveCategory.mutateAsync({ body: { type, name: values.name, parentId, sortOrder, ...appearance } }));
      onOpenChange(false);
    } catch {
      form.setError('root', { message: t('errors.generic') });
    }
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(category ? 'categories.edit' : 'categories.new')}</DialogTitle>
            <DialogDescription>{t(`categories.types.${type}`)}</DialogDescription>
          </DialogHeader>
          {/* How the category will look in lists, as it's being edited. */}
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2" aria-hidden>
            <CategoryIcon icon={previewIcon} color={previewColor} />
            <span className="truncate font-medium">{previewName?.trim() || t('categories.name')}</span>
          </div>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              {errors.root?.message && (
                <Alert variant="destructive">
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              )}
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="category-name">{t('categories.name')}</FieldLabel>
                <Input id="category-name" aria-invalid={!!errors.name} {...form.register('name')} />
                <FieldError errors={[errors.name]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="category-parent">{t('categories.parent')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="parentId"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!canHaveParent}>
                      <SelectTrigger id="category-parent" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TOP_LEVEL}>{t('categories.topLevel')}</SelectItem>
                        {parentOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {!canHaveParent && <FieldDescription>{t('categories.hasSubcategories')}</FieldDescription>}
              </Field>
              <Field>
                <FieldLabel htmlFor="category-color">{t('categories.color')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="color"
                  render={({ field }) => <ColorPicker id="category-color" value={field.value} onChange={field.onChange} />}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="category-icon">{t('categories.icon')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="icon"
                  render={({ field }) => (
                    <IconPicker id="category-icon" value={field.value} color={previewColor} onChange={field.onChange} />
                  )}
                />
              </Field>
            </FieldGroup>
            <DialogFooter className="mt-6">
              {category && canDelete && (
                <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirmingDelete(true)}>
                  {t('common.delete')}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {category && (
        <DeleteCategoryDialog
          groupId={groupId}
          category={category}
          subcategories={subcategories}
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          onDeleted={() => onOpenChange(false)}
        />
      )}
    </>
  );
}
