import { CloudOffIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnline } from './install';

/**
 * A quiet line across the top when the network is gone: what's on screen is the last thing the app
 * was told, and nothing can be saved until it's back.
 */
export function OfflineNotice() {
  const { t } = useTranslation();
  const online = useOnline();

  if (online) {
    return null;
  }

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 bg-muted px-4 py-1.5 text-xs text-muted-foreground"
    >
      <CloudOffIcon className="size-3.5 shrink-0" />
      {t('pwa.offline')}
    </div>
  );
}
