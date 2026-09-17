import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

// Temporary landing page for the scaffold commit: proves routing, Tailwind, shadcn/ui and i18n
// (browser-detected language) are wired together. Replaced by the authenticated shell next.
export function HomePlaceholder() {
  const { t } = useTranslation();

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('app.name')}</h1>
        <p className="text-muted-foreground">{t('app.tagline')}</p>
      </div>
      <Button>{t('app.getStarted')}</Button>
    </main>
  );
}
