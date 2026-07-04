import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly keyId: string;
  private readonly keySecret: string;
  private client: Razorpay | null = null;

  constructor(private readonly config: ConfigService) {
    this.keyId = this.config.get<string>('RAZORPAY_KEY_ID', '');
    this.keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET', '');

    if (!this.keyId || !this.keySecret) {
      // Deliberately not throwing here — payments are one feature among many, and a missing key
      // shouldn't take down restaurants/orders/delivery. We fail loudly but only when a payment
      // is actually attempted (see createOrder below), not at app startup.
      this.logger.warn(
        'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — payment endpoints will fail until these are configured in .env',
      );
    } else {
      this.client = new Razorpay({ key_id: this.keyId, key_secret: this.keySecret });
    }
  }

  /**
   * Creates a Razorpay order for the given amount (in rupees). Razorpay's API expects
   * the amount in the smallest currency unit (paise), so we multiply by 100 here —
   * callers should always pass rupees, not paise, to avoid double-converting.
   */
  async createOrder(amountInRupees: number, receipt: string) {
    if (!this.client) {
      throw new BadRequestException(
        'Payments are not configured yet — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env',
      );
    }
    return this.client.orders.create({
      amount: Math.round(amountInRupees * 100),
      currency: 'INR',
      receipt,
    });
  }

  /**
   * Verifies the signature Razorpay's checkout returns after a successful payment.
   * This is the step that actually confirms the payment is genuine and wasn't forged
   * client-side — never mark an order as paid without this passing.
   */
  verifySignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string): boolean {
    const expectedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    return expectedSignature === signature;
  }
}
