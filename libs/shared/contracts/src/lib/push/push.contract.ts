import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';

const c = initContract();

/**
 * Web Push: the notifications a device gets while the app is closed, as opposed to the live
 * updates a running app gets over the socket (see realtime-event.ts).
 *
 * A device registers itself with the push service its browser trusts (Google's, Mozilla's,
 * Apple's) and hands the API what came back: a URL to post to, and the two keys every payload is
 * encrypted to. The API can send to that URL but can't read what it sent, and the push service
 * can carry it but can't read it either.
 *
 * Registration is per device, not per person: signing in on a phone and a laptop makes two, and
 * each is told about what its owner switched on there.
 */

// What a device asks to be told about. Each one is its own switch in settings.
export const PUSH_TOPICS = [
  // Someone else in a group recorded a transaction. Never your own, whichever device recorded it.
  'transactions',
  // You were added to a group.
  'members',
  // A planned transaction has come round and is now part of the ledger.
  'planned',
] as const;
export type PushTopic = (typeof PUSH_TOPICS)[number];
export const pushTopicSchema = z.enum(PUSH_TOPICS);

// What a new device starts with: the two occasional ones.
//
// 'transactions' is deliberately not among them, though it is the one most worth having in a
// group that wants it. In a busy shared budget it is also the most frequent thing that happens,
// and an app that buzzes on every coffee is one whose notifications get turned off altogether —
// taking the other two with them. So it is offered, unticked, for the people who do want it, and
// an open app still shows every change at once over the socket either way.
export const DEFAULT_PUSH_TOPICS: readonly PushTopic[] = ['members', 'planned'];

// A push service's URL for one device. Long, opaque, and the closest thing to an identifier a
// subscription has — the API stores one row per endpoint and replaces it when the same device
// registers again, so re-subscribing never leaves a second copy behind.
const endpointSchema = z.string().url().max(1000);

export const pushSubscriptionKeysSchema = z.object({
  // The device's public key and auth secret, base64url, exactly as the browser handed them over.
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
});

export const pushSubscriptionSchema = z.object({
  id: z.string().uuid(),
  endpoint: endpointSchema,
  // May be empty: a device that has been quietened but still holds the browser's permission, so
  // turning a topic back on doesn't have to ask for it again.
  topics: z.array(pushTopicSchema),
  createdAt: z.string().datetime(),
  lastNotifiedAt: z.string().datetime().nullable(),
});

export const pushContract = c.router(
  {
    publicKey: {
      method: 'GET',
      path: '/push/public-key',
      responses: {
        // null where the API has no VAPID key configured: push is off for this deployment, and
        // the app says so rather than offering a switch that could only fail.
        200: z.object({ publicKey: z.string().nullable() }),
      },
      summary: 'The VAPID public key a device subscribes with, or null where push is not set up',
    },
    list: {
      method: 'GET',
      path: '/push/subscriptions',
      responses: { 200: z.array(pushSubscriptionSchema) },
      // Whether this browser's own registration is among them is how the app knows the switch is
      // on: the browser can hold a subscription the API has since forgotten, and what the API
      // holds is what actually gets sent to.
      summary: "The caller's own registered devices",
    },
    subscribe: {
      method: 'PUT',
      path: '/push/subscription',
      body: z.object({
        endpoint: endpointSchema,
        keys: pushSubscriptionKeysSchema,
        topics: z.array(pushTopicSchema),
        // Only to tell devices apart in a list; never matched on.
        userAgent: z.string().max(400).optional(),
      }),
      responses: { 200: pushSubscriptionSchema, 400: errorSchema },
      summary: 'Register this device for push, or change what it is told about',
    },
    unsubscribe: {
      method: 'DELETE',
      path: '/push/subscription',
      // The endpoint rather than the row's id: it's what the browser hands back, so a device can
      // always unregister itself without having kept anything from when it registered.
      body: z.object({ endpoint: endpointSchema }),
      responses: { 200: z.object({ removed: z.boolean() }) },
      summary: 'Stop sending notifications to this device',
    },
    test: {
      method: 'POST',
      path: '/push/test',
      body: z.object({}),
      responses: {
        // How many of the caller's devices the push services accepted it for. Zero means none is
        // registered — delivery itself is never promised, only that it was handed over.
        200: z.object({ sent: z.number().int() }),
        503: errorSchema,
      },
      summary: "Send a notification to the caller's own devices, to check that they arrive",
    },
  },
  { pathPrefix: '/api' },
);
