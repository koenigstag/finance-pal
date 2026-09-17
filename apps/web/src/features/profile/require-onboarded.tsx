import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router';
import { FullPageSpinner } from '@/components/full-page-spinner';
import { QueryError } from '@/components/query-error';
import { useStores } from '@/stores/stores-context';
import { useOnboardingStatus, useProfile } from './queries';

/**
 * Guards the app proper: a signed-in user without a complete profile goes to onboarding first.
 * Also where the profile's language takes over the UI from browser detection.
 */
export function RequireOnboarded() {
  const { locale } = useStores();
  const status = useOnboardingStatus();
  const profile = useProfile();
  const language = profile.data?.language ?? null;

  useEffect(() => {
    locale.setProfileLanguage(language);
  }, [locale, language]);

  // Leaving the signed-in part of the app (logout, session expiry) hands the UI back to the
  // browser's language, so the login page doesn't stay in the previous user's.
  useEffect(() => () => locale.setProfileLanguage(null), [locale]);

  if (status.isPending || profile.isPending) {
    return <FullPageSpinner />;
  }
  if (status.isError || profile.isError) {
    return (
      <QueryError
        onRetry={() => {
          void status.refetch();
          void profile.refetch();
        }}
      />
    );
  }
  if (!status.data.isOnboarded) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}
