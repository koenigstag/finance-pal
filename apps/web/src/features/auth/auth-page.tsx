import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation } from 'react-router';
import { authContract } from '@ft/shared-contracts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError, api, unwrap } from '@/lib/api/client';
import { tokenStore } from '@/lib/api/token-store';
import { useSession } from './use-session';

type Mode = 'login' | 'register';

// Login and register take the same body; the contract's schema is the form's schema, so the
// client can't accept anything the API would reject (or reject what it accepts).
const credentialsSchema = authContract.login.body;

interface Credentials {
  email: string;
  password: string;
}

interface RedirectState {
  from?: string;
}

export function AuthPage({ mode }: { mode: Mode }) {
  const { t } = useTranslation();
  const session = useSession();
  const location = useLocation();
  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: '', password: '' },
  });

  if (session) {
    return <Navigate to={(location.state as RedirectState | null)?.from ?? '/'} replace />;
  }

  const onSubmit = form.handleSubmit(async (credentials) => {
    try {
      const { user, accessToken, refreshToken } =
        mode === 'login'
          ? await unwrap(api.auth.login({ body: credentials }), 200)
          : await unwrap(api.auth.register({ body: credentials }), 201);
      tokenStore.set({ user: { id: user.id, email: user.email }, accessToken, refreshToken });
    } catch (error) {
      form.setError('root', { message: authErrorMessage(error, mode, t) });
    }
  });

  const rootError = form.formState.errors.root?.message;

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t(mode === 'login' ? 'auth.login.title' : 'auth.register.title')}</CardTitle>
          <CardDescription>{t('app.name')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              {rootError && (
                <Alert variant="destructive">
                  <AlertDescription>{rootError}</AlertDescription>
                </Alert>
              )}
              <Field data-invalid={!!form.formState.errors.email}>
                <FieldLabel htmlFor="email">{t('auth.email')}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  aria-invalid={!!form.formState.errors.email}
                  {...form.register('email')}
                />
                <FieldError errors={[form.formState.errors.email]} />
              </Field>
              <Field data-invalid={!!form.formState.errors.password}>
                <FieldLabel htmlFor="password">{t('auth.password')}</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  aria-invalid={!!form.formState.errors.password}
                  {...form.register('password')}
                />
                <FieldError errors={[form.formState.errors.password]} />
              </Field>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t(mode === 'login' ? 'auth.login.submit' : 'auth.register.submit')}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                {mode === 'login' ? (
                  <>
                    {t('auth.login.noAccount')} <Link className="underline" to="/register">{t('auth.register.title')}</Link>
                  </>
                ) : (
                  <>
                    {t('auth.register.haveAccount')} <Link className="underline" to="/login">{t('auth.login.title')}</Link>
                  </>
                )}
              </p>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function authErrorMessage(error: unknown, mode: Mode, t: (key: 'auth.errors.invalidCredentials' | 'auth.errors.emailTaken' | 'errors.generic') => string): string {
  if (error instanceof ApiError) {
    if (mode === 'login' && error.status === 401) {
      return t('auth.errors.invalidCredentials');
    }
    if (mode === 'register' && error.status === 409) {
      return t('auth.errors.emailTaken');
    }
  }
  return t('errors.generic');
}
