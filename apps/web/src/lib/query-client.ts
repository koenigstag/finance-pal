import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live updates arrive over the socket, so a refetch on every window focus is mostly noise.
      refetchOnWindowFocus: false,
      // A 4xx won't fix itself on retry; network errors and 5xx get two more attempts.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
    },
  },
});
