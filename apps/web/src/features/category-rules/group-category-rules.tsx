import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defineAbilityFor } from '@ft/shared-contracts';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { QueryError } from '@/components/query-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { categoryOptions, useCategories, type Category } from '@/features/categories/queries';
import type { Group } from '@/features/groups/queries';
import { filedUnder } from '@/features/transactions/filed-under';
import { patternTaken, useCategoryRules, useDeleteCategoryRule, useSaveCategoryRule, type CategoryRule } from './queries';

const CATEGORY_TYPES = ['expense', 'income'] as const;

/**
 * The group's category rules, and adding or changing one: a piece of text, and the category a
 * payment from a bank notification goes in when the shop's name contains it. The same form adds
 * and changes; picking a rule's pencil fills it in.
 */
export function GroupCategoryRules({ group, open }: { group: Group; open: boolean }) {
  const { t } = useTranslation();
  const rules = useCategoryRules(group.id, open);
  const categories = useCategories(group.id);
  const save = useSaveCategoryRule(group.id);
  const remove = useDeleteCategoryRule(group.id);

  const ability = defineAbilityFor({ role: group.role, archived: group.archivedAt !== null });
  const canManage = ability.can('create', 'CategoryRule');

  // The rule the form is changing; null while it adds a new one.
  const [editing, setEditing] = useState<CategoryRule | null>(null);
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();

  const reset = () => {
    setEditing(null);
    setPattern('');
    setCategoryId(undefined);
  };

  const categoriesById = useMemo(() => new Map((categories.data ?? []).map((category) => [category.id, category])), [categories.data]);
  const groupedOptions = useMemo(
    () =>
      CATEGORY_TYPES.map((type) => ({ type, options: categoryOptions(categories.data ?? [], type) })).filter(
        ({ options }) => options.length > 0,
      ),
    [categories.data],
  );

  const trimmed = pattern.trim();
  const taken = trimmed.length > 0 && rules.data !== undefined && patternTaken(rules.data, trimmed, editing?.id);
  const ready = canManage && trimmed.length > 0 && categoryId !== undefined && !taken;

  const submit = () => {
    if (!ready || categoryId === undefined) {
      return;
    }
    save.mutate({ ruleId: editing?.id, body: { pattern: trimmed, categoryId } }, { onSuccess: reset });
  };

  const startEditing = (rule: CategoryRule) => {
    save.reset();
    setEditing(rule);
    setPattern(rule.pattern);
    // A rule whose category was archived since keeps the choice empty: it has to be picked anew.
    setCategoryId(categoriesById.has(rule.categoryId) ? rule.categoryId : undefined);
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('categoryRules.description')}</p>

      {canManage ? (
        <FieldGroup>
          <Field data-invalid={taken}>
            <FieldLabel htmlFor="rule-pattern">{t('categoryRules.pattern')}</FieldLabel>
            <Input
              id="rule-pattern"
              value={pattern}
              maxLength={120}
              placeholder={t('categoryRules.patternPlaceholder')}
              aria-invalid={taken}
              onChange={(event) => setPattern(event.target.value)}
            />
            {taken && <FieldError>{t('categoryRules.taken', { pattern: trimmed })}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="rule-category">{t('categoryRules.category')}</FieldLabel>
            <Select value={categoryId ?? ''} onValueChange={setCategoryId}>
              <SelectTrigger id="rule-category" className="w-full">
                <SelectValue placeholder={t('categoryRules.chooseCategory')} />
              </SelectTrigger>
              <SelectContent>
                {groupedOptions.map(({ type, options }) => (
                  <SelectGroup key={type}>
                    <SelectLabel>{t(`categories.types.${type}`)}</SelectLabel>
                    {options.map(({ category, depth }) => (
                      <SelectItem key={category.id} value={category.id}>
                        <span className="flex items-center gap-2" style={{ paddingInlineStart: `${depth}rem` }}>
                          <AppearanceIcon icon={category.icon} color={category.color} size="sm" />
                          {category.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex gap-2">
            {editing && (
              <Button variant="outline" className="flex-1" onClick={reset}>
                {t('common.cancel')}
              </Button>
            )}
            <Button className="flex-1" onClick={submit} disabled={!ready || save.isPending}>
              {save.isPending ? <Spinner /> : !editing && <PlusIcon />}
              {editing ? t('common.save') : t('categoryRules.add')}
            </Button>
          </div>
        </FieldGroup>
      ) : (
        <p className="text-sm text-muted-foreground">
          {group.archivedAt !== null ? t('categoryRules.archivedGroup') : t('categoryRules.readOnly')}
        </p>
      )}

      {(save.isError || remove.isError) && (
        <Alert variant="destructive">
          <AlertDescription>{t('errors.generic')}</AlertDescription>
        </Alert>
      )}

      {rules.isPending ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : rules.isError ? (
        <QueryError onRetry={() => void rules.refetch()} />
      ) : rules.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('categoryRules.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y">
          {rules.data.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              category={categoriesById.get(rule.categoryId)}
              find={(id) => categoriesById.get(id)}
              canManage={canManage}
              editing={editing?.id === rule.id}
              removing={remove.isPending && remove.variables === rule.id}
              onEdit={() => startEditing(rule)}
              onRemove={() => {
                if (editing?.id === rule.id) {
                  reset();
                }
                remove.mutate(rule.id);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  category,
  find,
  canManage,
  editing,
  removing,
  onEdit,
  onRemove,
}: {
  rule: CategoryRule;
  // Undefined when the category is archived: the list only holds the ones in use.
  category: Category | undefined;
  find: (id: string) => Category | undefined;
  canManage: boolean;
  editing: boolean;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  // Where it files, read the way a transaction's category reads: "Transport › Taxi".
  const filed = category
    ? filedUnder(
        category.parentId === null
          ? { categoryId: category.id, subcategoryId: null }
          : { categoryId: category.parentId, subcategoryId: category.id },
        find,
      )
    : undefined;

  return (
    <li className="flex items-center gap-3 py-2">
      <AppearanceIcon icon={filed?.icon} color={filed?.color} placeholder={filed ? undefined : 'none'} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{rule.pattern}</p>
        <p className="truncate text-sm text-muted-foreground">{filed?.name ?? t('categoryRules.archivedCategory')}</p>
      </div>
      {canManage && (
        <>
          <Button
            variant={editing ? 'secondary' : 'ghost'}
            size="icon"
            aria-label={t('categoryRules.edit', { pattern: rule.pattern })}
            onClick={onEdit}
          >
            <PencilIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('categoryRules.remove', { pattern: rule.pattern })}
            disabled={removing}
            onClick={onRemove}
          >
            {removing ? <Spinner /> : <Trash2Icon />}
          </Button>
        </>
      )}
    </li>
  );
}
