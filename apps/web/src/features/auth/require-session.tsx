import { Navigate, Outlet, useLocation } from 'react-router';
import { useSession } from './use-session';

/**
 * Guards every route below it. Reacts to the session disappearing at any time — logout in
 * another tab, or a refresh token rejected mid-use — not just on first render.
 */
export function RequireSession() {
  const session = useSession();
  const location = useLocation();

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Outlet />;
}
