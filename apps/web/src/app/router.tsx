import { ChartPieIcon, PiggyBankIcon } from 'lucide-react';
import { createBrowserRouter, Navigate } from 'react-router';
import { ComingSoon } from '@/components/coming-soon';
import { AccountsPage } from '@/features/accounts/accounts-page';
import { AuthPage } from '@/features/auth/auth-page';
import { CategoriesPage } from '@/features/categories/categories-page';
import { RequireSession } from '@/features/auth/require-session';
import { CreateGroupPage } from '@/features/groups/create-group-page';
import { GroupIndexRedirect } from '@/features/groups/group-index-redirect';
import { GroupLayout } from '@/features/groups/group-layout';
import { useTranslation } from 'react-i18next';
import { OnboardingPage } from '@/features/profile/onboarding-page';
import { RequireOnboarded } from '@/features/profile/require-onboarded';
import { SettingsPage } from '@/features/profile/settings-page';
import { TransactionsPage } from '@/features/transactions/transactions-page';

export const router = createBrowserRouter(
  [
    { path: '/login', element: <AuthPage mode="login" /> },
    { path: '/register', element: <AuthPage mode="register" /> },
    {
      element: <RequireSession />,
      children: [
        { path: '/onboarding', element: <OnboardingPage /> },
        {
          element: <RequireOnboarded />,
          children: [
            { path: '/', element: <GroupIndexRedirect /> },
            { path: '/groups/new', element: <CreateGroupPage /> },
            { path: '/settings', element: <SettingsPage /> },
            // The active group lives in the URL, so a reload or a shared link keeps it.
            {
              path: '/g/:groupId',
              element: <GroupLayout />,
              children: [
                // Accounts is the group's start page.
                { index: true, element: <Navigate to="accounts" replace /> },
                { path: 'accounts', element: <AccountsPage /> },
                { path: 'categories', element: <CategoriesPage /> },
                { path: 'transactions', element: <TransactionsPage /> },
                { path: 'budget', element: <ComingSoonRoute titleKey="nav.budget" icon={PiggyBankIcon} /> },
                { path: 'overview', element: <ComingSoonRoute titleKey="nav.overview" icon={ChartPieIcon} /> },
              ],
            },
          ],
        },
      ],
    },
  ],
  // BASE_URL is Vite's `base`: "/" normally, the repository path (e.g. "/finance-pal/") on a
  // GitHub Pages project site. Routes and links stay written from the app's root either way.
  { basename: import.meta.env.BASE_URL },
);

// Budget and Overview have their tabs already; the pages come later.
function ComingSoonRoute({ titleKey, icon }: { titleKey: 'nav.budget' | 'nav.overview'; icon: typeof PiggyBankIcon }) {
  const { t } = useTranslation();
  return <ComingSoon title={t(titleKey)} icon={icon} />;
}
