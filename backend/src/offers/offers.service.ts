import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Offer } from './entities/offer.entity';
import { OfferRedemption } from './entities/offer-redemption.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { calculateDeliveryFee } from '../orders/delivery-fee.util';
import { computeTaxesAndFees } from '../orders/gst-config.util';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface ResolvedOffer {
  offer: Offer;
  discountAmount: number;
}

@Injectable()
export class OffersService {
  constructor(
    @InjectRepository(Offer) private readonly offerRepo: Repository<Offer>,
    @InjectRepository(OfferRedemption) private readonly redemptionRepo: Repository<OfferRedemption>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(Restaurant) private readonly restaurantRepo: Repository<Restaurant>,
  ) {}

  // ============================== CRUD (restaurant-owned) ==============================

  async create(restaurantId: string, dto: CreateOfferDto): Promise<Offer> {
    this.validateDiscountFields(dto);
    const restaurant = await this.restaurantRepo.findOne({ where: { id: restaurantId } });
    if (!restaurant) throw new NotFoundException('Restaurant not found');

    if (dto.code) {
      const normalizedCode = dto.code.trim().toUpperCase();
      const clash = await this.offerRepo.findOne({ where: { restaurant: { id: restaurantId }, code: normalizedCode } });
      if (clash) throw new BadRequestException(`Code "${normalizedCode}" is already in use by another offer`);
    }

    const offer = this.offerRepo.create({
      restaurant,
      name: dto.name,
      code: dto.code ? dto.code.trim().toUpperCase() : null,
      discountType: dto.discountType as any,
      discountValue: dto.discountValue ?? null,
      maxDiscountAmount: dto.maxDiscountAmount ?? null,
      minOrderValue: dto.minOrderValue ?? null,
      audience: (dto.audience as any) ?? 'all',
      active: dto.active ?? true,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      daysOfWeek: dto.daysOfWeek ?? null,
      startTime: dto.startTime ?? null,
      endTime: dto.endTime ?? null,
      usageLimitPerCustomer: dto.usageLimitPerCustomer ?? null,
      totalUsageLimit: dto.totalUsageLimit ?? null,
    });
    return this.offerRepo.save(offer);
  }

  async findMine(restaurantId: string): Promise<Offer[]> {
    return this.offerRepo.find({ where: { restaurant: { id: restaurantId } }, order: { createdAt: 'DESC' } });
  }

  async findOneForOwner(offerId: string, restaurantId: string): Promise<Offer> {
    const offer = await this.offerRepo.findOne({ where: { id: offerId }, relations: { restaurant: true } });
    if (!offer) throw new NotFoundException('Offer not found');
    if (offer.restaurant.id !== restaurantId) {
      throw new ForbiddenException('You can only manage your own offers');
    }
    return offer;
  }

  async update(offerId: string, restaurantId: string, dto: UpdateOfferDto): Promise<Offer> {
    const offer = await this.findOneForOwner(offerId, restaurantId);
    this.validateDiscountFields({ ...offer, ...dto } as CreateOfferDto);

    if (dto.code !== undefined) {
      const normalizedCode = dto.code ? dto.code.trim().toUpperCase() : null;
      if (normalizedCode) {
        const clash = await this.offerRepo.findOne({ where: { restaurant: { id: restaurantId }, code: normalizedCode } });
        if (clash && clash.id !== offerId) {
          throw new BadRequestException(`Code "${normalizedCode}" is already in use by another offer`);
        }
      }
      offer.code = normalizedCode;
    }

    for (const key of [
      'name',
      'discountType',
      'discountValue',
      'maxDiscountAmount',
      'minOrderValue',
      'audience',
      'active',
      'startDate',
      'endDate',
      'daysOfWeek',
      'startTime',
      'endTime',
      'usageLimitPerCustomer',
      'totalUsageLimit',
    ] as const) {
      if (dto[key] !== undefined) (offer as any)[key] = dto[key];
    }
    return this.offerRepo.save(offer);
  }

  async remove(offerId: string, restaurantId: string): Promise<void> {
    const offer = await this.findOneForOwner(offerId, restaurantId);
    await this.offerRepo.remove(offer);
  }

  /** Public listing for the customer menu page — automatic offers in full, code offers as a blind teaser (never leaks the code itself). */
  async findPublicForRestaurant(restaurantId: string) {
    const offers = await this.offerRepo.find({ where: { restaurant: { id: restaurantId }, active: true } });
    const nowEligible = offers.filter((o) => this.isCurrentlyRunning(o));
    return nowEligible.map((o) => ({
      id: o.id,
      name: o.name,
      hasCode: Boolean(o.code),
      discountType: o.discountType,
      discountValue: o.discountValue,
      maxDiscountAmount: o.maxDiscountAmount,
      minOrderValue: o.minOrderValue,
      audience: o.audience,
    }));
  }

  private validateDiscountFields(dto: Partial<CreateOfferDto>) {
    if (dto.discountType === 'percentage') {
      if (dto.discountValue == null) throw new BadRequestException('discountValue is required for a percentage offer');
      if (dto.discountValue > 100) throw new BadRequestException('A percentage discount cannot exceed 100');
    }
    if (dto.discountType === 'flat' && dto.discountValue == null) {
      throw new BadRequestException('discountValue is required for a flat offer');
    }
    if (dto.startDate && dto.endDate && dto.startDate > dto.endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }
    if (dto.startTime && dto.endTime && dto.startTime >= dto.endTime) {
      throw new BadRequestException('startTime must be before endTime');
    }
  }

  // ============================== Eligibility engine ==============================

  /** Day/date/time-window check only — the rules that don't depend on who's ordering. */
  private isCurrentlyRunning(offer: Offer, now: Date = new Date()): boolean {
    const todayStr = now.toISOString().slice(0, 10);
    if (offer.startDate && todayStr < offer.startDate) return false;
    if (offer.endDate && todayStr > offer.endDate) return false;

    if (offer.daysOfWeek && offer.daysOfWeek.length > 0) {
      const todayName = DAY_NAMES[now.getDay()];
      if (!offer.daysOfWeek.includes(todayName)) return false;
    }

    if (offer.startTime && offer.endTime) {
      const nowTime = now.toTimeString().slice(0, 5); // HH:mm
      if (nowTime < offer.startTime || nowTime > offer.endTime) return false;
    }

    return true;
  }

  /** Every rule, with a specific reason returned for the one that fails — used to give a
   *  customer typing a code a real answer instead of a generic "invalid". */
  private async checkEligibility(
    offer: Offer,
    customerId: string,
    subtotal: number,
  ): Promise<{ eligible: true } | { eligible: false; reason: string }> {
    if (!offer.active) return { eligible: false, reason: 'This offer is no longer active' };
    if (!this.isCurrentlyRunning(offer)) return { eligible: false, reason: 'This offer is not running right now' };

    if (offer.minOrderValue && subtotal < offer.minOrderValue) {
      return { eligible: false, reason: `This offer needs a minimum order of ₹${offer.minOrderValue}` };
    }

    if (offer.audience === 'first_order') {
      const priorDelivered = await this.orderRepo.count({
        where: { customer: { id: customerId }, restaurant: { id: offer.restaurant.id }, status: OrderStatus.DELIVERED },
      });
      if (priorDelivered > 0) {
        return { eligible: false, reason: 'This offer is for first-time customers only' };
      }
    }

    if (offer.usageLimitPerCustomer) {
      const usedByCustomer = await this.redemptionRepo.count({
        where: { offer: { id: offer.id }, customer: { id: customerId } },
      });
      if (usedByCustomer >= offer.usageLimitPerCustomer) {
        return { eligible: false, reason: 'You have already used this offer the maximum number of times' };
      }
    }

    if (offer.totalUsageLimit) {
      const usedTotal = await this.redemptionRepo.count({ where: { offer: { id: offer.id } } });
      if (usedTotal >= offer.totalUsageLimit) {
        return { eligible: false, reason: 'This offer has reached its usage limit' };
      }
    }

    return { eligible: true };
  }

  private computeDiscount(offer: Offer, subtotal: number, deliveryFee: number): number {
    if (offer.discountType === 'free_delivery') return deliveryFee;
    if (offer.discountType === 'flat') return Math.min(Number(offer.discountValue), subtotal);
    // percentage
    const raw = subtotal * (Number(offer.discountValue) / 100);
    const capped = offer.maxDiscountAmount ? Math.min(raw, Number(offer.maxDiscountAmount)) : raw;
    return Math.min(capped, subtotal);
  }

  /**
   * The actual resolution called from order creation. A valid code always wins outright —
   * if a code was given, we don't even look at automatic offers, and an invalid/ineligible
   * code throws rather than silently falling back (a customer who typed a code expects it
   * to either work or tell them why not, never nothing).
   */
  async resolveOffer(
    restaurantId: string,
    customerId: string,
    subtotal: number,
    deliveryFee: number,
    promoCode?: string,
  ): Promise<ResolvedOffer | null> {
    if (promoCode) {
      const normalizedCode = promoCode.trim().toUpperCase();
      const offer = await this.offerRepo.findOne({
        where: { restaurant: { id: restaurantId }, code: normalizedCode },
        relations: { restaurant: true },
      });
      if (!offer) throw new BadRequestException('That promo code is not valid for this restaurant');

      const check = await this.checkEligibility(offer, customerId, subtotal);
      if (!check.eligible) throw new BadRequestException(check.reason);

      return { offer, discountAmount: this.computeDiscount(offer, subtotal, deliveryFee) };
    }

    // No code — evaluate every automatic offer, keep the eligible ones, pick the biggest discount
    const automaticOffers = await this.offerRepo.find({
      where: { restaurant: { id: restaurantId }, active: true, code: IsNull() },
      relations: { restaurant: true },
    });

    let best: ResolvedOffer | null = null;
    for (const offer of automaticOffers) {
      const check = await this.checkEligibility(offer, customerId, subtotal);
      if (!check.eligible) continue;
      const discountAmount = this.computeDiscount(offer, subtotal, deliveryFee);
      if (!best || discountAmount > best.discountAmount) {
        best = { offer, discountAmount };
      }
    }
    return best;
  }

  /** Same as previewOffer, but computes the real distance-based delivery fee first —
   *  needed for an accurate free_delivery preview at checkout, before the order exists. */
  async previewOfferWithRealFee(
    restaurantId: string,
    customerId: string,
    subtotal: number,
    latitude: number,
    longitude: number,
    promoCode?: string,
  ) {
    const distanceRow = await this.restaurantRepo.manager.query(
      `SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as dist FROM restaurants WHERE id = $3`,
      [longitude, latitude, restaurantId],
    );
    const distanceMeters = parseFloat(distanceRow[0]?.dist ?? '0');
    const deliveryFee = calculateDeliveryFee(distanceMeters);
    const preview = await this.previewOffer(restaurantId, customerId, subtotal, deliveryFee, promoCode);
    // Taxes & fees — always computed, but stay genuinely zero until GST_ENABLED is set.
    // Included here so checkout can show the real breakdown live, fully dormant today.
    return { ...preview, ...computeTaxesAndFees(subtotal, deliveryFee) };
  }

  /**
   * Live checkout preview — same rules as resolveOffer, but never throws. A customer
   * typing a code at checkout needs to see WHY it didn't work inline, not a fetch error;
   * order placement itself still calls resolveOffer() and is the authoritative check.
   */
  async previewOffer(
    restaurantId: string,
    customerId: string,
    subtotal: number,
    deliveryFee: number,
    promoCode?: string,
  ): Promise<{ applied: boolean; offerName?: string; discountAmount?: number; reason?: string; deliveryFee: number }> {
    try {
      const resolved = await this.resolveOffer(restaurantId, customerId, subtotal, deliveryFee, promoCode);
      if (!resolved) return { applied: false, deliveryFee };
      return { applied: true, offerName: resolved.offer.name, discountAmount: resolved.discountAmount, deliveryFee };
    } catch (err) {
      return { applied: false, reason: err.message, deliveryFee };
    }
  }

  /** Records that an offer was actually used — called once, right after the order that used it is saved. */
  async recordRedemption(offer: Offer, orderId: string, customerId: string, discountAmount: number): Promise<void> {
    await this.redemptionRepo.save(
      this.redemptionRepo.create({
        offer,
        order: { id: orderId } as Order,
        customer: { id: customerId } as any,
        discountAmount,
      }),
    );
  }
}
