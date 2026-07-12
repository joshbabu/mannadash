import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from './entities/push-subscription.entity';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(
    @InjectRepository(PushSubscription)
    private readonly subscriptionRepo: Repository<PushSubscription>,
    private readonly config: ConfigService,
  ) {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY', '');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY', '');
    if (!publicKey || !privateKey) {
      // Same non-crashing pattern as RazorpayService/UploadsService — push just won't work
      // until configured, rather than taking down the whole app.
      this.logger.warn('VAPID keys not set — push notifications will silently no-op until configured in .env');
      return;
    }
    webpush.setVapidDetails('mailto:admin@mannadash.example', publicKey, privateKey);
    this.configured = true;
  }

  async saveSubscription(subscriberId: string, subscriberRole: string, subscription: Record<string, any>) {
    // Replace any existing subscription for this subscriber+endpoint rather than accumulating
    // duplicates every time the browser re-subscribes (e.g. after clearing site data)
    await this.subscriptionRepo.delete({ subscriberId, subscriberRole });
    return this.subscriptionRepo.save(this.subscriptionRepo.create({ subscriberId, subscriberRole, subscription }));
  }

  /**
   * Sends a push notification to every subscription on file for this subscriber. Silently
   * no-ops if push isn't configured yet (see constructor) or the subscriber has no subscription
   * (e.g. hasn't enabled notifications, or is using a browser that doesn't support push).
   */
  async sendToSubscriber(subscriberId: string, subscriberRole: string, payload: { title: string; body: string }) {
    if (!this.configured) return;

    const subs = await this.subscriptionRepo.find({ where: { subscriberId, subscriberRole } });
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub.subscription as any, JSON.stringify(payload));
      } catch (err: any) {
        // A 410/404 means the browser's subscription expired or was revoked — clean it up so we
        // stop wasting calls on a dead endpoint
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await this.subscriptionRepo.delete({ id: sub.id });
        } else {
          // err.message alone is unhelpfully generic ("Received unexpected response
          // code") for WebPushError — the actual reason lives in statusCode/body, which
          // is what actually distinguishes "bad VAPID config" from "payload too large"
          // from "subscription expired but not yet 410'd" etc.
          this.logger.warn(
            `Push send failed for subscriber ${subscriberId} (role: ${subscriberRole}): ` +
              `status=${err?.statusCode} body=${err?.body} message=${err?.message}`,
          );
        }
      }
    }
  }
}
