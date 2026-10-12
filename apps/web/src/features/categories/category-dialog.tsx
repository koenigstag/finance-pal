import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CATEGORY_ICON_NAMES, defaultAppearance } from '@/components/appearance/appearance';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { ColorPicker, IconPicker } from '@/components/appearance/appearance-picker';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCurrencies } from '@/features/currencies/queries';
import { useProfile } from '@/features/profile/queries';
import { DeleteCategoryDialog } from './delete-category-dialog';
import { nextSortOrder, useCategoryUsage, useSaveCategory, useSetCategoryArchived, type Category } from './queries';

// Radix Select can't hold an empty value, so "no parent" needs a stand-in, and so does "no currency".
const TOP_LEVEL = 'top';
const NO_CURRENCY = 'none';

// archived is the form's own, not the body's: archiving is a route of its own, and saved as one.
// currencyId is a select's value: a currency's id as text, NO_CURRENCY, or '' while a new
// category's default — the main currency — is still loading.
const categoryFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string(),
  currencyId: z.string(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  archived: z.boolean(),
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
  const currencies = useCurrencies();
  const profile = useProfile();
  const saveCategory = useSaveCategory(groupId);
  const setArchived = useSetCategoryArchived(groupId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const form = useForm<CategoryFormValues>({ resolver: zodResolver(categoryFormSchema) });
  const errors = form.formState.errors;

  // The currency what's filed under the category is in: a subcategory's is its parent's. Once
  // something is, it stays — those amounts were recorded in it — so it's fixed while the category
  // has transactions, and while that's still being found out. A category without one can always
  // be given one.
  const parentOf = (id: string | null | undefined) => categories.find((candidate) => candidate.id === id);
  const currentCurrencyId = category ? (category.parentId ? (parentOf(category.parentId)?.currencyId ?? null) : category.currencyId) : null;
  const usage = useCategoryUsage(groupId, category?.id ?? '', open && currentCurrencyId !== null);
  const currencyLocked =
    currentCurrencyId !== null && (!usage.data || usage.data.transactionCount + usage.data.plannedTransactionCount > 0);

  // Categories are two levels deep: parents are top-level categories of the same type, and one
  // that has subcategories of its own can't become a subcategory. Archived ones are not offered —
  // nothing new is filed under one — except the parent this category already sits under, so that
  // editing a subcategory put away with its parent still says where it belongs. Nor, for one whose
  // currency is fixed, a parent in another currency.
  const parentOptions = useMemo(
    () =>
      categories
        .filter(
          (candidate) =>
            candidate.type === type &&
            candidate.parentId === null &&
            candidate.id !== category?.id &&
            (!candidate.archived || candidate.id === category?.parentId) &&
            (!currencyLocked || candidate.currencyId === currentCurrencyId),
        )
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    [categories, type, category?.id, category?.parentId, currencyLocked, currentCurrencyId],
  );
  const subcategories = category ? categories.filter((candidate) => candidate.parentId === category.id) : [];
  const canHaveParent = subcategories.length === 0;
  const [previewName, previewIcon, previewColor, pickedParentId] = useWatch({
    control: form.control,
    name: ['name', 'icon', 'color', 'parentId'],
  });
  const mainCurrencyId = profile.data?.mainCurrencyId;

  useEffect(() => {
    if (open) {
      const parentId = category?.parentId ?? defaultParentId ?? null;
      // A new category starts from its parent's look, or the next color of the palette.
      const suggested = defaultAppearance(
        categories.find((candidate) => candidate.id === parentId),
        categories.filter((candidate) => candidate.type === type && candidate.parentId === parentId).length,
      );
      // An existing one shows the currency it's in; a new one starts in its parent's, or the main
      // currency — once that's known.
      const currencyId = category ? currentCurrencyId : parentId ? (parentOf(parentId)?.currencyId ?? null) : mainCurrencyId;
      form.reset({
        name: category?.name ?? '',
        parentId: parentId ?? TOP_LEVEL,
        currencyId: currencyId === undefined ? '' : currencyId === null ? NO_CURRENCY : String(currencyId),
        icon: category ? category.icon : suggested.icon,
        color: category ? category.color : suggested.color,
        archived: category?.archived ?? false,
      });
    }
    // Only on opening: the categories list refetching must not overwrite a pick in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category, defaultParentId, form]);

  // The profile can still be loading when a new category's dialog opens; its main currency goes in
  // once it arrives, unless one was picked meanwhile.
  useEffect(() => {
    if (open && mainCurrencyId !== undefined && form.getValues('currencyId') === '') {
      form.setValue('currencyId', String(mainCurrencyId));
    }
  }, [open, mainCurrencyId, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    const parentId = values.parentId === TOP_LEVEL ? null : values.parentId;
    // A category that moves (or a new one) goes to the end of its new siblings.
    const sortOrder =
      category && category.parentId === parentId ? undefined : nextSortOrder(categories, type, parentId);
    const appearance = { icon: values.icon, color: values.color };
    // Only a top-level category holds one; a subcategory is left to its parent's.
    const currency =
      parentId === null && values.currencyId !== ''
        ? { currencyId: values.currencyId === NO_CURRENCY ? null : Number(values.currencyId) }
        : {};
    try {
      await (category
        ? saveCategory.mutateAsync({
            categoryId: category.id,
            body: { name: values.name, parentId, sortOrder, ...currency, ...appearance },
          })
        : saveCategory.mutateAsync({ body: { type, name: values.name, parentId, sortOrder, ...currency, ...appearance } }));
      // Its own request, after the fields and only when the checkbox moved: the category has to
      // exist to be put away, and saving the rest is what the dialog is mostly for.
      if (category && values.archived !== category.archived) {
        await setArchived.mutateAsync({ categoryId: category.id, archived: values.archived });
      }
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
            <AppearanceIcon icon={previewIcon} color={previewColor} />
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
              {/* A subcategory is in its parent's currency, so only a top-level category asks. */}
              {pickedParentId === TOP_LEVEL && (
                <Field>
                  <FieldLabel htmlFor="category-currency">{t('categories.currency')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="currencyId"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} disabled={currencyLocked}>
                        <SelectTrigger id="category-currency" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_CURRENCY}>{t('categories.noCurrency')}</SelectItem>
                          {currencies.data?.map((currency) => (
                            <SelectItem key={currency.id} value={String(currency.id)}>
                              {currency.code} — {currency.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldDescription>
                    {t(currencyLocked ? 'categories.currencyLocked' : 'categories.currencyDescription')}
                  </FieldDescription>
                </Field>
              )}
              {/* Only for a category that exists: there is nothing to put away until it does. */}
              {category && (
                <Controller
                  control={form.control}
                  name="archived"
                  render={({ field }) => (
                    <Field orientation="horizontal">
                      <Checkbox
                        id="category-archived"
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                      <FieldContent>
                        <FieldLabel htmlFor="category-archived">{t('categories.archivedCategory')}</FieldLabel>
                        <FieldDescription>{t('categories.archivedCategoryDescription')}</FieldDescription>
                      </FieldContent>
                    </Field>
                  )}
                />
              )}
              <Field>
                <FieldLabel htmlFor="category-color">{t('categories.color')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="color"
                  render={({ field }) => <ColorPicker id="category-color" label={t('categories.color')} value={field.value} onChange={field.onChange} />}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="category-icon">{t('categories.icon')}</FieldLabel>
                <Controller
                  control={form.control}
                  name="icon"
                  render={({ field }) => (
                    <IconPicker
                      id="category-icon"
                      label={t('categories.icon')}
                      names={CATEGORY_ICON_NAMES}
                      value={field.value}
                      color={previewColor}
                      onChange={field.onChange}
                    />
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
          parent={categories.find((candidate) => candidate.id === category.parentId)}
          subcategories={subcategories}
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          onDeleted={() => onOpenChange(false)}
        />
      )}
    </>
  );
}
