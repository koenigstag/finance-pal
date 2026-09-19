import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { errorSchema } from '../common/error.schema.js';
import { timezoneSchema } from '../common/timezone.schema.js';

const c = initContract();

/**
 * A note somebody in a group schedules for a moment that hasn't come yet — "settle up", "rent
 * goes out tomorrow" — which reaches the whole group as a notification when it does.
 *
 * Unlike everything else the app notifies about, the words are the person's own rather than the
 * catalogue's, so they are not translated: whoever wrote them chose the language along with the
 * text. It is a group's note, not a private one; anyone who may record money in the group may
 * schedule one, and anyone in the group sees what is coming.
 */
export const scheduledNotificationSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  text: z.string(),
  // The moment itself. The zone it was picked in travels beside it so the app can show back the
  // time that was chosen — 09:00 in Kyiv stays 09:00 in Kyiv on a laptop in Berlin.
  sendAt: z.string().datetime(),
  timezone: z.string(),
  // When the scheduler handed it to the push services; null while it is still to come.
  sentAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});

// Long enough for a sentence, short enough that a phone shows the whole of it on a locked screen.
const textSchema = z.string().trim().min(1).max(200);

const groupPathParams = z.object({ groupId: z.string().uuid() });
const notificationPathParams = z.object({ groupId: z.string().uuid(), notificationId: z.string().uuid() });

export const scheduledNotificationsContract = c.router(
  {
    list: {
      method: 'GET',
      path: '/groups/:groupId/scheduled-notifications',
      pathParams: groupPathParams,
      responses: { 200: z.array(scheduledNotificationSchema), 404: errorSchema },
      summary: "A group's scheduled notifications: the ones still to come, and the past week's",
    },
    create: {
      method: 'POST',
      path: '/groups/:groupId/scheduled-notifications',
      pathParams: groupPathParams,
      body: z.object({
        text: textSchema,
        // Must lie ahead: a moment that has passed would either never arrive or arrive at once.
        sendAt: z.string().datetime({ offset: true }),
        timezone: timezoneSchema,
      }),
      responses: { 201: scheduledNotificationSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Schedule a notification for the whole group',
    },
    remove: {
      method: 'DELETE',
      path: '/groups/:groupId/scheduled-notifications/:notificationId',
      pathParams: notificationPathParams,
      responses: { 200: scheduledNotificationSchema, 403: errorSchema, 404: errorSchema },
      summary: 'Call off a scheduled notification; one already sent can only be cleared from the list',
    },
  },
  { pathPrefix: '/api' },
);
