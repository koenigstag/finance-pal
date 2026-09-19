import { zodResolver } from '@hookform/resolvers/zod';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { changePasswordFieldsSchema } from '@ft/shared-contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError, api, unwrap } from '@/lib/api/client';
import { useStores } from '@/stores/stores-context';

interface PasswordFormMessages {
  sameAsCurrent: string;
  mismatch: string;
}

// The contract's own fields, plus the repetition that never leaves the browser. Both rules the
// API also enforces are checked here too, so they land on the field they're about instead of
// coming back as a failed request.
function passwordFormSchema(messages: PasswordFormMessages) {
  return changePasswordFieldsSchema.extend({ confirmPassword: z.string() }).superRefine((values, ctx) => {
    if (values.newPassword && values.newPassword === values.currentPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newPassword'], message: messages.sameAsCurrent });
    }
    if (values.confirmPassword !== values.newPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: messages.mismatch });
    }
  });
}

type PasswordFormValues = z.infer<ReturnType<typeof passwordFormSchema>>;

const EMPTY: PasswordFormValues = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * Changing the account password from the settings page.
 *
 * A successful change revokes every refresh token the account had, this device's included, so
 * the new pair the API hands back replaces the stored one — otherwise the tab that just changed
 * the password would be logged out along with the rest.
 */
export const ChangePasswordCard = observer(function ChangePasswordCard() {
  const { t } = useTranslation();
  const { session } = useStores();
  const [changed, setChanged] = useState(false);
  const schema = useMemo(
    () =>
      passwordFormSchema({
        sameAsCurrent: t('settings.password.errors.sameAsCurrent'),
        mismatch: t('settings.password.errors.mismatch'),
      }),
    [t],
  );
  const form = useForm<PasswordFormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      const tokens = await unwrap(api.auth.changePassword({ body: { currentPassword, newPassword } }), 200);
      session.updateTokens(tokens.accessToken, tokens.refreshToken);
      form.reset(EMPTY);
      setChanged(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        form.setError('currentPassword', { message: t('settings.password.errors.incorrect') });
        return;
      }
      form.setError('root', { message: t('errors.generic') });
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.password.title')}</CardTitle>
        <CardDescription>{t('settings.password.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            {errors.root?.message && (
              <Alert variant="destructive">
                <AlertDescription>{errors.root.message}</AlertDescription>
              </Alert>
            )}
            <Field data-invalid={!!errors.currentPassword}>
              <FieldLabel htmlFor="currentPassword">{t('settings.password.current')}</FieldLabel>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.currentPassword}
                {...form.register('currentPassword')}
              />
              <FieldError errors={[errors.currentPassword]} />
            </Field>
            <Field data-invalid={!!errors.newPassword}>
              <FieldLabel htmlFor="newPassword">{t('settings.password.new')}</FieldLabel>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.newPassword}
                {...form.register('newPassword')}
              />
              <FieldError errors={[errors.newPassword]} />
            </Field>
            <Field data-invalid={!!errors.confirmPassword}>
              <FieldLabel htmlFor="confirmPassword">{t('settings.password.confirm')}</FieldLabel>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.confirmPassword}
                {...form.register('confirmPassword')}
              />
              <FieldError errors={[errors.confirmPassword]} />
            </Field>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Spinner />}
              {t('settings.password.submit')}
            </Button>
            {/* Until the fields are touched again, in which case it's about to stop being true. */}
            {changed && !form.formState.isDirty && (
              <p className="text-center text-sm text-muted-foreground">{t('settings.password.changed')}</p>
            )}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
});
