import { ArrowLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AppHeader } from '@/app/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { readLastGroupId } from '@/features/groups/last-group';
import { NotificationsCard } from './notifications-card';
import { usePushPublicKey } from './queries';

/**
 * Notifications, on their own page rather than a card among the other settings: what reaches this
 * device is a set of switches per device, and it has more to say than a colour scheme does.
 *
 * Whether the deployment does push at all is settled here, once. Settings only links to this page
 * where it does, so reaching it otherwise means following an old link or a deployment that has
 * changed under an open tab — hence a plain line saying so, rather than an empty page.
 */
export function NotificationsPage() {
  const { t } = useTranslation();
  const publicKey = usePushPublicKey();
  const lastGroupId = readLastGroupId() ?? undefined;
  const key = publicKey.data?.publicKey;

  let content;
  if (publicKey.isPending) {
    content = <Spinner className="mx-auto size-6 text-muted-foreground" />;
  } else if (!key) {
    content = (
      <Card>
        <CardContent className="text-sm text-muted-foreground">{t('settings.notifications.unavailable')}</CardContent>
      </Card>
    );
  } else {
    content = <NotificationsCard publicKey={key} />;
  }

  return (
    <>
      <AppHeader currentGroupId={lastGroupId} page={{ title: t('settings.notifications.title'), backTo: '/settings' }} />
      <main className="mx-auto flex max-w-xl flex-col gap-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {/* The title and the way back are in the header; from md up the back button joins them. */}
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/settings" aria-label={t('common.back')}>
              <ArrowLeftIcon />
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">{t('settings.notifications.title')}</h1>
        </div>
        {content}
      </main>
    </>
  );
}
