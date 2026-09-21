import { BellIcon, ChevronRightIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Card, CardContent } from '@/components/ui/card';
import { usePushPublicKey } from './queries';

/**
 * The way from settings into the notifications page, in the same shape as the rows inside a
 * group's settings: an icon, where it goes, and a chevron.
 *
 * Nothing at all where this deployment has no keys to sign with — there would be nothing behind
 * the link, and nothing the person reading it could do about that. The answer is cached for the
 * session, so the page it leads to doesn't ask again.
 */
export function NotificationsLink() {
  const { t } = useTranslation();
  const publicKey = usePushPublicKey();

  if (!publicKey.data?.publicKey) {
    return null;
  }

  return (
    <Card className="py-2">
      <CardContent className="px-2">
        <Link
          to="/settings/notifications"
          className="flex min-h-12 items-center gap-3 rounded-lg px-2 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted [&_svg]:size-4">
            <BellIcon />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t('settings.notifications.title')}</span>
            <span className="block text-xs text-muted-foreground">{t('settings.notifications.summary')}</span>
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      </CardContent>
    </Card>
  );
}
