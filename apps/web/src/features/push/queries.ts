import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { DEFAULT_PUSH_TOPICS, type PushTopic } from '@ft/shared-contracts';
import { api, unwrap } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';
import {
  currentRegistration,
  forgetDevice,
  isPushSupported,
  registerDevice,
  requestPermission,
  type DeviceRegistration,
} from './push';

/** The key devices subscribe with, or null where this deployment has push switched off. */
export function usePushPublicKey() {
  return useQuery({
    queryKey: queryKeys.pushPublicKey,
    queryFn: () => unwrap(api.push.publicKey(), 200),
    // One value for the life of a deployment; asking again would only spend a request.
    staleTime: Infinity,
  });
}

/** What this browser is registered as with its push service, if anything. */
export function useDeviceRegistration() {
  return useQuery({
    queryKey: queryKeys.pushDevice,
    queryFn: () => currentRegistration(),
    enabled: isPushSupported(),
  });
}

/** Every device the signed-in person has registered — this one among them, or not. */
export function usePushSubscriptions() {
  return useQuery({
    queryKey: queryKeys.pushSubscriptions,
    queryFn: () => unwrap(api.push.list(), 200),
  });
}

export interface EnablePushResult {
  permission: NotificationPermission;
  // False where the browser said yes but there was no worker to register with — a development
  // server, or a page that hasn't finished installing one.
  registered: boolean;
}

/**
 * Turns notifications on for this device: asks the browser first, and only tells the API once it
 * has a subscription to give it. Nothing is stored anywhere if the person says no.
 */
export function useEnablePush() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ publicKey, topics }: { publicKey: string; topics?: PushTopic[] }): Promise<EnablePushResult> => {
      const permission = await requestPermission();
      if (permission !== 'granted') {
        return { permission, registered: false };
      }

      const device = await registerDevice(publicKey);
      if (!device) {
        return { permission, registered: false };
      }

      await unwrap(
        api.push.subscribe({
          body: { ...device, topics: [...(topics ?? DEFAULT_PUSH_TOPICS)], userAgent: deviceName() },
        }),
        200,
      );
      return { permission, registered: true };
    },
    onSuccess: () => refreshPushState(queryClient),
  });
}

/** Changes what this device is told about, keeping its registration. */
export function useSetPushTopics() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ device, topics }: { device: DeviceRegistration; topics: PushTopic[] }) =>
      unwrap(api.push.subscribe({ body: { ...device, topics, userAgent: deviceName() } }), 200),
    onSuccess: () => refreshPushState(queryClient),
  });
}

/**
 * Turns them off. The endpoint is passed in as well as taken from the browser: where the browser
 * has already dropped its subscription by itself, the API's record of this device would otherwise
 * be left behind, still being sent to.
 */
export function useDisablePush() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (endpoint: string) => {
      const dropped = await forgetDevice();
      await unwrap(api.push.unsubscribe({ body: { endpoint: dropped ?? endpoint } }), 200);
    },
    onSuccess: () => refreshPushState(queryClient),
  });
}

/** Sends one to this person's devices, to see whether they arrive. */
export function useSendTestPush() {
  return useMutation({ mutationFn: () => unwrap(api.push.test({ body: {} }), 200) });
}

/**
 * Takes this device off the list on the way out, while the session that owns it is still valid.
 * Without it the next notification for whoever just left would arrive on a browser they have
 * signed out of — and the person signing in next would see it.
 */
export async function unregisterThisDevice(): Promise<void> {
  const endpoint = await forgetDevice();
  if (endpoint) {
    await unwrap(api.push.unsubscribe({ body: { endpoint } }), 200);
  }
}

// Cut to what the API accepts: this is only ever read by a person telling their devices apart,
// and a browser with an unusually talkative user agent shouldn't fail to register over it.
function deviceName(): string {
  return navigator.userAgent.slice(0, 400);
}

function refreshPushState(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.pushDevice }),
    queryClient.invalidateQueries({ queryKey: queryKeys.pushSubscriptions }),
  ]);
}
