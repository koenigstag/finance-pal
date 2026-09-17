import { createBrowserRouter } from 'react-router';
import { AccountsPage } from '@/features/accounts/accounts-page';
import { AuthPage } from '@/features/auth/auth-page';
import { RequireSession } from '@/features/auth/require-session';
import { CreateGroupPage } from '@/features/groups/create-group-page';
import { GroupIndexRedirect } from '@/features/groups/group-index-redirect';
import { GroupLayout } from '@/features/groups/group-layout';
import { GroupHome } from '@/features/home/group-home';
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
                { index: true, element: <GroupHome /> },
                { path: 'accounts', element: <AccountsPage /> },
                { path: 'transactions', element: <TransactionsPage /> },
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
