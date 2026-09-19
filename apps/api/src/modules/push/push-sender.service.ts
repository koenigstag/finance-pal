import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebPushError, sendNotification } from 'web-push';
import type { PushPayload } from '@ft/shared-contracts';
import type { Env } from '../_core/config/env.schema';

// How long a push service holds a notification for a device that is off or out of signal. A day:
// a phone left overnight still gets last night's, and anything older has been overtaken by the
// ledger it was about.
const TTL_SECONDS = 60 * 60 * 24;

/** One device to send to, and the language whoever owns it reads the app in. */
export interface PushTarget {
  subscriptionId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: string;
}

// 'gone': the push service says this device isn't there any more, so its row goes with it.
// 'failed': it may well work next time — the row stays and nothing is retried now.
export type PushDelivery = 'sent' | 'gone' | 'failed';

/**
 * The one place that talks to push services (Google's, Mozilla's, Apple's).
 *
 * Push is optional: with no VAPID keys configured every method here is a no-op and the API tells
 * the app so, rather than offering a switch that could only fail. That is the normal state of a
 * development machine, and a deployment that doesn't want notifications.
 *
 * Sending is best-effort by nature — a push service accepting a message says nothing about a
 * device ever showing it — so nothing here throws. The notification is the ledger's echo, never
 * the ledger itself.
 */
@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);
  private readonly vapid: { subject: string; publicKey: string; privateKey: string } | null;

  constructor(config: ConfigService<Env, true>) {
    const publicKey = config.get('VAPID_PUBLIC_KEY', { infer: true });
    const privateKey = config.get('VAPID_PRIVATE_KEY', { infer: true });
    const subject = config.get('VAPID_SUBJECT', { infer: true });
    // env.schema refuses a half-configured set, so one of them present means all three are.
    this.vapid = publicKey && privateKey && subject ? { subject, publicKey, privateKey } : null;
    if (!this.vapid) {
      this.logger.log('No VAPID keys configured — push notifications are off');
    }
  }

  get isConfigured(): boolean {
    return this.vapid !== null;
  }

  /** What a device subscribes with; null where this deployment has no keys. */
  get publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  /** Hands one payload to one device's push service, encrypted to that device's keys. */
  async send(target: PushTarget, payload: PushPayload): Promise<PushDelivery> {
    if (!this.vapid) {
      return 'failed';
    }

    try {
      await sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        JSON.stringify(payload),
        { vapidDetails: this.vapid, TTL: TTL_SECONDS, urgency: 'normal' },
      );
      return 'sent';
    } catch (error) {
      // 404/410 is the push service saying this subscription is finished: the app was
      // uninstalled, the permission revoked, or the browser rotated it. Anything else — the
      // service is down, the network blinked — is worth keeping the device for.
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
        return 'gone';
      }
      const reason = error instanceof WebPushError ? `${error.statusCode} ${error.body}` : String(error);
      // The service's host, never the endpoint itself: the full URL is what lets anyone holding
      // it send to that device, and logs are the wrong place for it.
      this.logger.warn(`Push to ${pushServiceHost(target.endpoint)} failed: ${reason}`);
      return 'failed';
    }
  }
}

function pushServiceHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'an unreadable endpoint';
  }
}
