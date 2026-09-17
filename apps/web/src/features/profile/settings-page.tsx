import { ArrowLeftIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AppHeader } from '@/app/app-header';
import { QueryError } from '@/components/query-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { detectLanguage, isSupportedLanguage } from '@/i18n';
import { AppearanceCard } from '@/theme/appearance-card';
import { LogoutCard } from '@/features/auth/logout-card';
import { readLastGroupId } from '@/features/groups/last-group';
import { ExchangeRatesCard } from './exchange-rates-card';
import { ProfileForm } from './profile-form';
import { useCurrencies } from '@/features/currencies/queries';
import { useProfile, useUpdateProfile } from './queries';

export function SettingsPage() {
  const { t } = useTranslation();
  const profile = useProfile();
  const currencies = useCurrencies();
  const updateProfile = useUpdateProfile();
  const lastGroupId = readLastGroupId() ?? undefined;

  let content;
  if (profile.isPending || currencies.isPending) {
    content = <Spinner className="mx-auto size-6 text-muted-foreground" />;
  } else if (profile.isError || currencies.isError || !profile.data) {
    // No profile can't happen past RequireOnboarded; treat it like a failed load if it does.
    content = (
      <QueryError
        onRetry={() => {
          void profile.refetch();
          void currencies.refetch();
        }}
      />
    );
  } else {
    const { displayName, startDayOfWeek, mainCurrencyId, language } = profile.data;
    content = (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.profile.title')}</CardTitle>
          <CardDescription>{t('settings.profile.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            defaultValues={{
              displayName: displayName ?? '',
              startDayOfWeek: startDayOfWeek ?? 1,
              mainCurrencyId,
              language: isSupportedLanguage(language) ? language : detectLanguage(),
            }}
            currencies={currencies.data}
            submitLabel={t('common.save')}
            // The saved language reaches the UI through RequireOnboarded, which follows the profile.
            onSubmit={(values) => updateProfile.mutateAsync(values)}
            footer={({ isDirty }) =>
              updateProfile.isSuccess &&
              !isDirty && <p className="text-center text-sm text-muted-foreground">{t('settings.saved')}</p>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <AppHeader currentGroupId={lastGroupId} />
      <main className="mx-auto flex max-w-xl flex-col gap-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/" aria-label={t('common.back')}>
              <ArrowLeftIcon />
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
        </div>
        <AppearanceCard />
        {content}
        <ExchangeRatesCard />
        <LogoutCard />
      </main>
    </>
  );
}
