import { ArrowLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { AppHeader } from '@/app/app-header';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AppearanceCard } from '@/theme/appearance-card';
import { ChangePasswordCard } from '@/features/auth/change-password-card';
import { LogoutCard } from '@/features/auth/logout-card';
import { readLastGroupId } from '@/features/groups/last-group';
import { NotificationsLink } from '@/features/push/notifications-link';
import { ExchangeRatesCard } from './exchange-rates-card';
import { ProfileCard } from './profile-card';

const TABS = ['profile', 'appearance', 'rates', 'account'] as const;
type SettingsTab = (typeof TABS)[number];

const isTab = (value: string | null): value is SettingsTab => TABS.includes(value as SettingsTab);

export function SettingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const lastGroupId = readLastGroupId() ?? undefined;
  // Which tab is open lives in the URL, so a reload comes back to it and a section can be linked
  // to. Anything else (a stale or hand-typed value) falls back to the first tab.
  const requestedTab = searchParams.get('tab');
  const tab: SettingsTab = isTab(requestedTab) ? requestedTab : 'profile';

  return (
    <>
      <AppHeader currentGroupId={lastGroupId} page={{ title: t('settings.title'), backTo: '/' }} />
      <main className="mx-auto flex max-w-xl flex-col gap-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {/* The title and the way back are in the header; from md up the back button joins them. */}
        <div className="hidden items-center gap-2 md:flex">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/" aria-label={t('common.back')}>
              <ArrowLeftIcon />
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
        </div>
        <Tabs
          value={tab}
          // Replaced rather than pushed: switching tabs shouldn't fill the back button with every
          // one visited on the way here.
          onValueChange={(value) =>
            setSearchParams(
              (params) => {
                params.set('tab', value);
                return params;
              },
              { replace: true },
            )
          }
        >
          <TabsList className="w-full overflow-x-auto" aria-label={t('settings.title')}>
            {TABS.map((value) => (
              // Smaller type on a phone: four labels have to share the width, and the longest
              // translations (ru) otherwise push the last one off the edge.
              <TabsTrigger key={value} value={value} className="text-xs sm:text-sm">
                {t(`settings.tabs.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="profile">
            <ProfileCard />
          </TabsContent>
          <TabsContent value="appearance">
            <AppearanceCard />
          </TabsContent>
          <TabsContent value="rates">
            <ExchangeRatesCard />
          </TabsContent>
          <TabsContent value="account" className="flex flex-col gap-4">
            {/* A row rather than a card: what it leads to is a page of its own, because it is
                about this device rather than this account and has more in it than a tab wants. */}
            <NotificationsLink />
            <ChangePasswordCard />
            <LogoutCard />
          </TabsContent>
        </Tabs>

      </main>
    </>
  );
}
