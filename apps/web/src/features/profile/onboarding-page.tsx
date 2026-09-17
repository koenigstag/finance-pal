import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { FullPageSpinner } from '@/components/full-page-spinner';
import { QueryError } from '@/components/query-error';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { detectLanguage, isSupportedLanguage } from '@/i18n';
import { useStores } from '@/stores/stores-context';
import { displayNameFromEmail } from './display-name';
import { ProfileForm, type ProfileFormValues } from './profile-form';
import { defaultCurrencyId, localeForLanguage } from '@/features/currencies/default-currency';
import { useCurrencies } from '@/features/currencies/queries';
import { useOnboardingStatus, useProfile, useUpdateProfile } from './queries';
import { detectStartDayOfWeek } from './week';

export function OnboardingPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { session } = useStores();
  const status = useOnboardingStatus();
  const profile = useProfile();
  const currencies = useCurrencies();
  const updateProfile = useUpdateProfile();

  if (status.isPending || profile.isPending || currencies.isPending) {
    return <FullPageSpinner />;
  }
  if (status.isError || profile.isError || currencies.isError) {
    return (
      <QueryError
        onRetry={() => {
          void status.refetch();
          void profile.refetch();
          void currencies.refetch();
        }}
      />
    );
  }
  if (status.data.isOnboarded) {
    return <Navigate to="/" replace />;
  }

  // A profile can already exist half-filled (e.g. a field added after this user onboarded), so
  // start from whatever it has and guess the rest from the browser.
  const existing = profile.data;
  const language = existing && isSupportedLanguage(existing.language) ? existing.language : detectLanguage();
  // The currency follows the language, through the browser's region when it's in that language
  // (en-GB → GBP) and the language's usual region otherwise (ru → RUB).
  const currencyForLanguage = (candidate: string) =>
    defaultCurrencyId(currencies.data, localeForLanguage(candidate, navigator.language));
  const defaultValues: ProfileFormValues = {
    displayName: existing?.displayName ?? displayNameFromEmail(session.session?.user.email, i18n.language),
    startDayOfWeek: existing?.startDayOfWeek ?? detectStartDayOfWeek(navigator.language),
    mainCurrencyId: existing?.mainCurrencyId ?? currencyForLanguage(language) ?? currencies.data[0].id,
    language,
  };

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('onboarding.title')}</CardTitle>
          <CardDescription>{t('onboarding.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            defaultValues={defaultValues}
            currencies={currencies.data}
            submitLabel={t('onboarding.submit')}
            currencyForLanguage={currencyForLanguage}
            onSubmit={async (values) => {
              await updateProfile.mutateAsync(values);
              await navigate('/', { replace: true });
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
