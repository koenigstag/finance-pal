import { useTranslation } from 'react-i18next';
import { QueryError } from '@/components/query-error';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { detectLanguage, isSupportedLanguage } from '@/i18n';
import { useCurrencies } from '@/features/currencies/queries';
import { ProfileForm } from './profile-form';
import { useProfile, useUpdateProfile } from './queries';

/** Name, main currency, week start and language: the Profile tab of the settings page. */
export function ProfileCard() {
  const { t } = useTranslation();
  const profile = useProfile();
  const currencies = useCurrencies();
  const updateProfile = useUpdateProfile();

  if (profile.isPending || currencies.isPending) {
    return <Spinner className="mx-auto size-6 text-muted-foreground" />;
  }

  if (profile.isError || currencies.isError || !profile.data) {
    // No profile can't happen past RequireOnboarded; treat it like a failed load if it does.
    return (
      <QueryError
        onRetry={() => {
          void profile.refetch();
          void currencies.refetch();
        }}
      />
    );
  }

  const { displayName, startDayOfWeek, mainCurrencyId, language } = profile.data;

  return (
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
