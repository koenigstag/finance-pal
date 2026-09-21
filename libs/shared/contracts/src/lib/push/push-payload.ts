import { z } from 'zod';

/**
 * What travels inside a push message, encrypted to the device.
 *
 * Not a ts-rest contract — it never goes over HTTP between these two — but it is the agreement
 * between the API, which composes it, and the service worker, which shows it (see
 * apps/web/public/push-handler.js). The text is already in the recipient's language: the worker
 * has no catalog of its own, and a notification has to read right the moment it arrives.
 *
 * Deliberately no amounts beyond the line being shown, and no ids beyond the link: a notification
 * is rendered by the operating system, on a screen that may well be locked.
 */
export const pushPayloadSchema = z.object({
  title: z.string(),
  body: z.string(),
  /**
   * Where tapping it goes, as a path relative to the app's scope ("g/<id>/transactions") — never
   * absolute, so it lands right whether the app is served from a domain root or from a project
   * path on GitHub Pages. Left out, the notification just opens the app.
   */
  path: z.string().optional(),
  /**
   * Notifications sharing a tag replace one another instead of stacking: five transactions added
   * to one group while the phone was away are one line about the last, not five to swipe through.
   */
  tag: z.string().optional(),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;
