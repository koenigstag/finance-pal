import { Navigate } from 'react-router';
import { FullPageSpinner } from '@/components/full-page-spinner';
import { QueryError } from '@/components/query-error';
import { readLastGroupId } from './last-group';
import { useGroups } from './queries';

/** "/" has no content of its own: it opens the last used group, or group creation if none. */
export function GroupIndexRedirect() {
  const groups = useGroups();

  if (groups.isPending) {
    return <FullPageSpinner />;
  }
  if (groups.isError) {
    return <QueryError onRetry={() => void groups.refetch()} />;
  }
  if (groups.data.length === 0) {
    return <Navigate to="/groups/new" replace />;
  }

  const lastGroupId = readLastGroupId();
  const target =
    groups.data.find((group) => group.id === lastGroupId) ??
    groups.data.find((group) => group.archivedAt === null) ??
    groups.data[0];
  return <Navigate to={`/g/${target.id}`} replace />;
}
