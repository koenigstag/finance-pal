import { useMutation, useQuery } from '@tanstack/react-query';
import type { ClientInferRequest } from '@ts-rest/core';
import type { oauthContract } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { deviceTimezone } from '@/lib/dates';
import { queryKeys } from '@/lib/query-keys';

export type AuthorizationRequest = ClientInferRequest<typeof oauthContract.describe>['query'];

const PARAMS = [
  'response_type',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
  'resource',
] as const satisfies readonly (keyof AuthorizationRequest)[];

/**
 * The authorization request an app sent, as the API handed it on in this page's address. Passed
 * back word for word: the API checks it again, and nothing on this page decides it's any good.
 */
export function authorizationRequestOf(search: URLSearchParams): AuthorizationRequest {
  const request: AuthorizationRequest = { client_id: search.get('client_id') ?? '' };
  for (const name of PARAMS) {
    const value = search.get(name);
    if (value !== null) {
      request[name] = value;
    }
  }
  return request;
}

export function useConsent(request: AuthorizationRequest) {
  return useQuery({
    queryKey: queryKeys.oauthConsent(JSON.stringify(request)),
    queryFn: () => unwrap(api.oauth.describe({ query: request }), 200),
    // A request the API refuses is refused for good; asking again only delays saying so.
    retry: false,
  });
}

/** Resolves with where to send the browser: back to the app, with its code. */
export function useApprove(request: AuthorizationRequest) {
  return useMutation({
    mutationFn: (groupId: string) =>
      unwrap(api.oauth.approve({ body: { ...request, groupId, timeZone: deviceTimezone() } }), 200),
  });
}
