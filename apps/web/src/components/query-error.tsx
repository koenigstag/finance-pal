import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function QueryError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 p-6">
      <Alert variant="destructive">
        <AlertDescription>{t('errors.generic')}</AlertDescription>
      </Alert>
      <Button variant="outline" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
