import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { groupsContract } from '@ft/shared-contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useCreateGroup, useGroups } from './queries';

const createGroupFormSchema = groupsContract.create.body.extend({
  name: z.string().trim().min(1).max(120),
  seed: z.boolean(),
});

type CreateGroupFormValues = z.infer<typeof createGroupFormSchema>;

export function CreateGroupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groups = useGroups();
  const createGroup = useCreateGroup();
  const form = useForm<CreateGroupFormValues>({
    resolver: zodResolver(createGroupFormSchema),
    defaultValues: { name: '', seed: true },
  });
  const errors = form.formState.errors;
  const isFirstGroup = groups.data?.length === 0;

  // The first group gets a ready name, so creating it can be a single click. Filled in once the
  // groups list confirms it's the first (and again on a language switch), but never over
  // something the user typed. Further groups start empty: another "Personal" would only confuse.
  useEffect(() => {
    if (isFirstGroup && !form.getFieldState('name').isDirty) {
      form.setValue('name', t('groups.create.defaultName'));
    }
  }, [isFirstGroup, form, t]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const group = await createGroup.mutateAsync(values);
      await navigate(`/g/${group.id}`, { replace: true });
    } catch {
      form.setError('root', { message: t('errors.generic') });
    }
  });

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('groups.create.title')}</CardTitle>
          <CardDescription>{t(isFirstGroup ? 'groups.create.firstDescription' : 'groups.create.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              {errors.root?.message && (
                <Alert variant="destructive">
                  <AlertDescription>{errors.root.message}</AlertDescription>
                </Alert>
              )}
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="name">{t('groups.create.name')}</FieldLabel>
                <Input
                  id="name"
                  placeholder={t('groups.create.namePlaceholder')}
                  aria-invalid={!!errors.name}
                  {...form.register('name')}
                />
                <FieldError errors={[errors.name]} />
              </Field>
              <Controller
                control={form.control}
                name="seed"
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Checkbox id="seed" checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                    <FieldContent>
                      <FieldLabel htmlFor="seed">{t('groups.create.seed')}</FieldLabel>
                      <FieldDescription>{t('groups.create.seedDescription')}</FieldDescription>
                    </FieldContent>
                  </Field>
                )}
              />
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t('groups.create.submit')}
              </Button>
              {!isFirstGroup && (
                <Button variant="ghost" asChild>
                  <Link to="/">{t('common.cancel')}</Link>
                </Button>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
