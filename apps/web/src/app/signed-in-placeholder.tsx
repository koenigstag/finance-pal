import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { logout, useSession } from '@/features/auth/use-session';

// Stands in for the app shell until onboarding and groups land in the next step.
export function SignedInPlaceholder() {
  const { t } = useTranslation();
  const session = useSession();

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
      <p className="text-muted-foreground">{t('auth.signedInAs', { email: session?.user.email ?? '' })}</p>
      <Button variant="outline" onClick={() => void logout()}>
        {t('auth.logout')}
      </Button>
    </main>
  );
}
