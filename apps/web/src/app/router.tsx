import { createBrowserRouter } from 'react-router';
import { AuthPage } from '@/features/auth/auth-page';
import { RequireSession } from '@/features/auth/require-session';
import { SignedInPlaceholder } from './signed-in-placeholder';

export const router = createBrowserRouter([
  { path: '/login', element: <AuthPage mode="login" /> },
  { path: '/register', element: <AuthPage mode="register" /> },
  {
    element: <RequireSession />,
    children: [{ path: '/', element: <SignedInPlaceholder /> }],
  },
]);
