import { observer } from 'mobx-react-lite';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useStores } from '@/stores/stores-context';

/**
 * Guards every route below it. Reacts to the session disappearing at any time — logout in
 * another tab, or a refresh token rejected mid-use — not just on first render.
 */
export const RequireSession = observer(function RequireSession() {
  const { session } = useStores();
  const location = useLocation();

  if (!session.isSignedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
});
