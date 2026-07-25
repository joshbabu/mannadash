import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { calculateDeliveryFee } from './delivery-fee.util';
import { DELIVERY_TYPE_CONFIG, isValidDeliveryType } from './delivery-type.util';
import { computeTaxesAndFees } from './gst-config.util';
import { getPlatformTaxProfile } from './platform-tax-profile.util';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Repository, SelectQueryBuilder } from 'typeorm';
import { Order, OrderStatus, PaymentMethod, PaymentStatus, RefundStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderItemOption } from './entities/order-item-option.entity';
import { Rating } from './entities/rating.entity';
import { Complaint } from './entities/complaint.entity';
import { Payout } from '../delivery-partners/entities/payout.entity';
import { Restaurant, RestaurantStatus } from '../restaurants/entities/restaurant.entity';
import { isWithinRestaurantHours, wallClockParts, RESTAURANT_TIME_ZONE, WEEK_DAYS } from '../restaurants/operating-hours.util';
import { MenuItem } from '../menu-items/entities/menu-item.entity';
import { Customer } from '../customers/entities/customer.entity';
import { RestaurantHistoryQueryDto } from './dto/restaurant-history-query.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateRatingDto } from './dto/create-rating.dto';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { RespondToComplaintDto } from './dto/respond-to-complaint.dto';
import { DeliveryPartnersService } from '../delivery-partners/delivery-partners.service';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { PushService } from '../push/push.service';
import { OrdersGateway } from './orders.gateway';
import { RazorpayService } from '../payments/razorpay.service';
import { OffersService } from '../offers/offers.service';

// Flat delivery fee for MVP — replace with distance-based calculation once rider assignment exists

// Valid forward-only status transitions — prevents e.g. jumping straight from placed to delivered
const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PLACED]: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  [OrderStatus.ACCEPTED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED],
  [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_PICKUP, OrderStatus.CANCELLED],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.PICKED_UP, OrderStatus.CANCELLED],
  [OrderStatus.PICKED_UP]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(Restaurant)
    private readonly restaurantRepo: Repository<Restaurant>,
    @InjectRepository(MenuItem)
    private readonly menuItemRepo: Repository<MenuItem>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Rating)
    private readonly ratingRepo: Repository<Rating>,
    @InjectRepository(Complaint)
    private readonly complaintRepo: Repository<Complaint>,
    @InjectRepository(Payout)
    private readonly payoutRepo: Repository<Payout>,
    private readonly deliveryPartnersService: DeliveryPartnersService,
    private readonly restaurantsService: RestaurantsService,
    private readonly pushService: PushService,
    private readonly ordersGateway: OrdersGateway,
    private readonly razorpayService: RazorpayService,
    private readonly offersService: OffersService,
  ) {}

  async create(userId: string, dto: CreateOrderDto): Promise<Order> {
    const customer = await this.customerRepo.findOne({ where: { user: { id: userId } } });
    if (!customer) {
      throw new NotFoundException('Customer profile not found for this account');
    }

    const restaurant = await this.restaurantRepo.findOne({ where: { id: dto.restaurantId } });
    if (!restaurant) {
      throw new NotFoundException(`Restaurant ${dto.restaurantId} not found`);
    }
    if (restaurant.status !== RestaurantStatus.APPROVED || !restaurant.isOpen) {
      throw new BadRequestException('This restaurant is not currently accepting orders');
    }

    // Order-for-later: validate the requested time is genuinely usable before doing
    // anything else, and check the restaurant's hours AT that time, not right now —
    // an order scheduled for 8pm shouldn't be blocked by the restaurant being closed
    // at 3pm when the request happens to be made.
    let scheduledFor: Date | null = null;
    if (dto.scheduledFor) {
      scheduledFor = new Date(dto.scheduledFor);
      const minLeadMs = 30 * 60 * 1000; // 30 minutes — enough that "scheduled" means something real, not indistinguishable from ASAP
      const maxLeadMs = 7 * 24 * 60 * 60 * 1000; // 7 days — a bound that keeps this a near-term feature, not open-ended
      const msUntil = scheduledFor.getTime() - Date.now();
      if (msUntil < minLeadMs) {
        throw new BadRequestException('Scheduled time must be at least 30 minutes from now');
      }
      if (msUntil > maxLeadMs) {
        throw new BadRequestException('Scheduled time cannot be more than 7 days from now');
      }
    }

    const hoursCheckTime = scheduledFor ?? new Date();
    if (!isWithinRestaurantHours(restaurant, hoursCheckTime)) {
      // Craft the message from whichever hours scheme this restaurant uses — per-day (new
      // onboarding wizard) or the legacy single daily window. Use the India wall-clock day
      // (same basis as the check above), not the server-local day, so the "today" it names
      // matches the day the check actually evaluated.
      const { day: istDay } = wallClockParts(hoursCheckTime, RESTAURANT_TIME_ZONE);
      const todayHours = restaurant.weeklyHours?.[WEEK_DAYS[istDay]];
      const hoursText = restaurant.weeklyHours
        ? todayHours
          ? `${scheduledFor ? "that day's" : "today's"} hours are ${todayHours.open}\u2013${todayHours.close}`
          : `it is closed ${scheduledFor ? 'on that day' : 'today'}`
        : `hours are ${restaurant.openTime}\u2013${restaurant.closeTime}`;
      throw new BadRequestException(
        scheduledFor
          ? `This restaurant won't be open at that time \u2014 ${hoursText}`
          : `This restaurant is currently closed \u2014 ${hoursText}`,
      );
    }

    const menuItemIds = dto.items.map((i) => i.menuItemId);
    const menuItems = await this.menuItemRepo.find({
      where: { id: In(menuItemIds) },
      relations: { restaurant: true, variantGroups: { options: true } },
    });

    // Validate every requested item exists, belongs to this restaurant, and is currently available.
    // Never trust client-sent prices — always price from the DB record.
    let subtotal = 0;
    const orderItems: OrderItem[] = [];

    for (const requested of dto.items) {
      const menuItem = menuItems.find((m) => m.id === requested.menuItemId);
      if (!menuItem) {
        throw new BadRequestException(`Menu item ${requested.menuItemId} not found`);
      }
      if (menuItem.restaurant.id !== restaurant.id) {
        throw new BadRequestException(`Menu item ${menuItem.name} does not belong to this restaurant`);
      }
      if (!menuItem.isAvailable) {
        throw new BadRequestException(`${menuItem.name} is currently unavailable`);
      }

      const priceAtOrder = this.resolveOrderItemPrice(menuItem, requested.selectedOptionIds ?? []);
      subtotal += priceAtOrder.total * requested.quantity;

      const orderItem = new OrderItem();
      orderItem.menuItem = menuItem;
      orderItem.quantity = requested.quantity;
      orderItem.priceAtOrder = priceAtOrder.total;
      orderItem.notes = requested.notes ?? null;
      orderItem.selectedOptions = priceAtOrder.selectedOptions;
      orderItems.push(orderItem);
    }

    if (restaurant.minOrderValue && subtotal < restaurant.minOrderValue) {
      throw new BadRequestException(
        `${restaurant.name} has a minimum order of ₹${restaurant.minOrderValue} (your cart is ₹${subtotal})`,
      );
    }

    // Distance between restaurant and delivery address — computed once, reused for both
    // the delivery fee (below) and the ETA estimate, since both are distance-driven.
    const distanceRow = await this.orderRepo.manager.query(
      `SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as dist FROM restaurants WHERE id = $3`,
      [dto.longitude, dto.latitude, restaurant.id],
    );
    const distanceMeters = parseFloat(distanceRow[0].dist);
    const deliveryFee = calculateDeliveryFee(distanceMeters);

    // L1: a customer-typed code always wins outright; otherwise the best eligible
    // automatic offer applies itself silently. Resolved AFTER delivery fee is known,
    // since a free_delivery offer's discount amount IS the delivery fee.
    const resolvedOffer = await this.offersService.resolveOffer(
      restaurant.id,
      customer.id,
      subtotal,
      deliveryFee,
      dto.promoCode,
    );
    const discountAmount = resolvedOffer?.discountAmount ?? 0;
    const appliedOfferName = resolvedOffer?.offer.name ?? null;

    const deliveryType = isValidDeliveryType(dto.deliveryType) ? dto.deliveryType : 'standard';
    const deliverySurcharge = DELIVERY_TYPE_CONFIG[deliveryType].surcharge;
    const tipAmount = dto.tipAmount ?? 0;

    const commissionAmount = Math.round(subtotal * (Number(restaurant.commissionRate) / 100) * 100) / 100;
    // Platform fee + GST — always server-computed from config (see gst-config.util.ts),
    // never from the client. Both default to 0 and stay 0 until explicitly enabled.
    // Packaging fee is the restaurant's own setting, clamped to the platform cap.
    const taxesAndFees = computeTaxesAndFees(subtotal, deliveryFee, restaurant.packagingFee);
    // A tip is money for the rider, never discounted or commissioned — added straight to
    // what the customer pays, same as the delivery-type surcharge (or Eco's small credit).
    const total = Math.max(0, subtotal + deliveryFee + deliverySurcharge + tipAmount + taxesAndFees.total - discountAmount);

    // Rough ETA: restaurant's stated prep time + a distance-based travel estimate, adjusted
    // by the chosen delivery tier. Express doesn't just promise faster — see
    // retryUnassignedReadyOrders() for the real dispatch-priority half of that promise.
    // Assumes ~20km/h average city delivery speed — doesn't account for real traffic,
    // so treat this as a reasonable estimate shown to the customer, not a guarantee.
    const AVG_DELIVERY_SPEED_MPS = 5.56;
    const travelSeconds = distanceMeters / AVG_DELIVERY_SPEED_MPS;
    const prepSeconds = restaurant.avgPrepTimeMins * 60;
    const etaAdjustmentSeconds = DELIVERY_TYPE_CONFIG[deliveryType].etaAdjustmentSeconds;
    const estimatedDeliveryAt = new Date(Date.now() + Math.max(60, prepSeconds + travelSeconds + etaAdjustmentSeconds) * 1000);

    // deliveryLocation needs a raw SQL expression, which TypeORM's save() doesn't support directly —
    // so we insert via query builder, same pattern used in RestaurantsService.create
    const insertResult = await this.orderRepo
      .createQueryBuilder()
      .insert()
      .into(Order)
      .values({
        customer,
        restaurant,
        status: OrderStatus.PLACED,
        paymentMethod: dto.paymentMethod === 'cod' ? PaymentMethod.COD : PaymentMethod.ONLINE,
        instructions: dto.instructions ?? null,
        cutleryNeeded: dto.cutleryNeeded ?? false,
        deliveryType,
        tipAmount,
        platformFeeAmount: taxesAndFees.platformFeeAmount,
        packagingFeeAmount: taxesAndFees.packagingFeeAmount,
        restaurantGstAmount: taxesAndFees.restaurantGstAmount,
        deliveryGstAmount: taxesAndFees.deliveryGstAmount,
        deliveryAddress: dto.deliveryAddress,
        deliveryLocation: () => `ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)`,
        subtotal,
        deliveryFee,
        commissionAmount,
        total,
        discountAmount: discountAmount || null,
        appliedOfferName,
        estimatedDeliveryAt,
        scheduledFor,
      } as any)
      .returning('*')
      .execute();

    const savedOrderId = insertResult.raw[0].id;

    // Now attach order items referencing the saved order id
    for (const item of orderItems) {
      item.order = { id: savedOrderId } as Order;
    }
    await this.orderRepo.manager.getRepository(OrderItem).save(orderItems);

    if (resolvedOffer) {
      await this.offersService.recordRedemption(resolvedOffer.offer, savedOrderId, customer.id, discountAmount);
    }

    const created = await this.findOne(savedOrderId);
    // Push directly to the restaurant's personal channel — this is what actually notifies them
    // of a brand new order, since they can't have subscribed to this order's room before it existed.
    this.ordersGateway.emitNewOrder(restaurant.id, created);
    // Also send a real push notification — reaches the restaurant even if their tab is closed
    this.pushService.sendToSubscriber(restaurant.id, 'restaurant', {
      title: 'New order!',
      body: `${created.customer.user.name} · ₹${Number(created.total).toFixed(0)}`,
    });
    return created;
  }

  /**
   * Validates the customer's variant selections against this menu item's actual variant
   * groups and computes the true per-unit price — never trusting client-sent prices, same
   * principle as the base-price lookup above. Rules, matching how Zomato-style pickers work:
   *  - every selected option id must genuinely belong to THIS menu item (not some other
   *    dish or restaurant's option — the obvious spoofing attempt to guard against)
   *  - a 'single' group (radio) must have exactly one option selected FROM THAT GROUP if
   *    required, and at most one if optional
   *  - a 'multiple' group (checkboxes) must have at least one selected if required, any
   *    number (including zero) if optional
   *  - final price = base menu item price + sum of every selected option's priceDelta
   */
  private resolveOrderItemPrice(
    menuItem: MenuItem,
    selectedOptionIds: string[],
  ): { total: number; selectedOptions: OrderItemOption[] } {
    const allOptionsById = new Map<string, { option: any; group: any }>();
    for (const group of menuItem.variantGroups ?? []) {
      for (const option of group.options ?? []) {
        allOptionsById.set(option.id, { option, group });
      }
    }

    // Security: reject any id that isn't genuinely one of this item's own options
    for (const id of selectedOptionIds) {
      if (!allOptionsById.has(id)) {
        throw new BadRequestException(`${menuItem.name}: an invalid customization was selected`);
      }
    }

    // Group the customer's selections by which variant group they belong to, so we can
    // check each group's own required/selectionType rule independently
    const selectedByGroupId = new Map<string, string[]>();
    for (const id of selectedOptionIds) {
      const { group } = allOptionsById.get(id)!;
      const list = selectedByGroupId.get(group.id) ?? [];
      list.push(id);
      selectedByGroupId.set(group.id, list);
    }

    for (const group of menuItem.variantGroups ?? []) {
      const chosen = selectedByGroupId.get(group.id) ?? [];
      if (group.required && chosen.length === 0) {
        throw new BadRequestException(`${menuItem.name}: please choose a "${group.name}" option`);
      }
      if (group.selectionType === 'single' && chosen.length > 1) {
        throw new BadRequestException(`${menuItem.name}: only one "${group.name}" option can be chosen`);
      }
    }

    let total = Number(menuItem.price);
    const selectedOptions: OrderItemOption[] = [];
    for (const id of selectedOptionIds) {
      const { option, group } = allOptionsById.get(id)!;
      total += Number(option.priceDelta);
      const snapshot = new OrderItemOption();
      snapshot.variantOption = option;
      snapshot.groupName = group.name;
      snapshot.optionLabel = option.label;
      snapshot.priceDeltaAtOrder = Number(option.priceDelta);
      selectedOptions.push(snapshot);
    }

    return { total, selectedOptions };
  }

  async findAllForCustomer(userId: string): Promise<Order[]> {
    const customer = await this.customerRepo.findOne({ where: { user: { id: userId } } });
    if (!customer) {
      throw new NotFoundException('Customer profile not found for this account');
    }

    return this.orderRepo.find({
      where: { customer: { id: customer.id } },
      relations: { restaurant: true, items: { menuItem: true, selectedOptions: true } },
      order: { placedAt: 'DESC' },
    });
  }

  // Restaurant-owner facing — lists orders placed AT their restaurant, not orders they placed as a customer
  async findAllForRestaurant(restaurantId: string): Promise<Order[]> {
    return this.orderRepo.find({
      where: { restaurant: { id: restaurantId } },
      relations: { customer: { user: true }, items: { menuItem: true, selectedOptions: true }, deliveryPartner: true },
      order: { placedAt: 'DESC' },
    });
  }

  /**
   * The Order History page: terminal orders (delivered/cancelled) with search, status and
   * date-range filters, plus summary cards computed over the SAME search + date filters —
   * so "last 7 days" + a customer search shows that slice's delivered/cancelled/revenue,
   * not all-time numbers next to a filtered list. Revenue counts delivered orders only.
   */
  async getRestaurantOrderHistory(restaurantId: string, query: RestaurantHistoryQueryDto) {
    const applyCommonFilters = <T extends SelectQueryBuilder<Order>>(qb: T): T => {
      qb.where('order.restaurantId = :restaurantId', { restaurantId });
      if (query.search) {
        qb.andWhere('(user.name ILIKE :search OR user.phone ILIKE :search OR CAST(order.id AS TEXT) ILIKE :search)', {
          search: `%${query.search}%`,
        });
      }
      if (query.from) qb.andWhere('order.placedAt >= :from', { from: query.from });
      if (query.to) qb.andWhere('order.placedAt <= :to', { to: query.to });
      return qb;
    };

    const listQb = applyCommonFilters(
      this.orderRepo
        .createQueryBuilder('order')
        .leftJoinAndSelect('order.customer', 'customer')
        .leftJoinAndSelect('customer.user', 'user')
        .leftJoinAndSelect('order.items', 'items')
        .leftJoinAndSelect('items.menuItem', 'menuItem'),
    )
      .andWhere('order.status IN (:...statuses)', {
        statuses: query.status ? [query.status] : [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      })
      .orderBy('order.placedAt', 'DESC')
      .take(query.limit ?? 50)
      .skip(query.offset ?? 0);

    // Summary spans BOTH terminal states regardless of the status filter — the cards are the
    // fixed reference point ("9 delivered, 0 cancelled, ₹4,612") while the list narrows.
    const summaryQb = applyCommonFilters(
      this.orderRepo
        .createQueryBuilder('order')
        .leftJoin('order.customer', 'customer')
        .leftJoin('customer.user', 'user'),
    ).select([
      `COUNT(*) FILTER (WHERE order.status = 'delivered') AS delivered`,
      `COUNT(*) FILTER (WHERE order.status = 'cancelled') AS cancelled`,
      `COALESCE(SUM(order.total) FILTER (WHERE order.status = 'delivered'), 0) AS revenue`,
    ]);

    const [orders, totalMatching, rawSummary] = await Promise.all([
      listQb.getMany(),
      listQb.getCount(),
      summaryQb.getRawOne(),
    ]);

    return {
      summary: {
        delivered: Number(rawSummary.delivered),
        cancelled: Number(rawSummary.cancelled),
        revenue: Number(rawSummary.revenue),
      },
      total: totalMatching,
      orders,
    };
  }

  // Rider facing — lists orders currently assigned to this rider
  async findAllForRider(riderId: string): Promise<Order[]> {
    return this.orderRepo.find({
      where: { deliveryPartner: { id: riderId } },
      relations: { restaurant: true, customer: { user: true }, items: { menuItem: true, selectedOptions: true } },
      order: { placedAt: 'DESC' },
    });
  }

  async findOne(id: string, requestingUserId?: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: {
        restaurant: true,
        customer: { user: true },
        items: { menuItem: true, selectedOptions: true },
        deliveryPartner: true,
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    // If a userId is provided (customer-facing lookup), enforce they can only see their own order
    if (requestingUserId && order.customer.user.id !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    return order;
  }

  // Backs GET /orders/:id/tax-invoice — real backend-computed invoice data rather than the
  // frontend guessing at it. Real fields (restaurant GSTIN/FSSAI, if that restaurant has
  // completed KYC for them) pass through as-is; genuinely-missing platform registration
  // data comes from getPlatformTaxProfile(), which defaults to obviously-fake TEST values
  // until real env vars are set — see that file. The invoice number is assigned once, the
  // first time this is called for a given order, then persisted and never changed again.
  async getTaxInvoiceData(orderId: string, requestingUserId: string) {
    const order = await this.findOne(orderId, requestingUserId);

    if (order.paymentStatus !== PaymentStatus.PAID) {
      throw new BadRequestException('A tax invoice is only available once payment is complete');
    }

    if (!order.invoiceNumber) {
      order.invoiceNumber = this.generateInvoiceNumber(order);
      await this.orderRepo.save(order);
    }

    return {
      invoiceNumber: order.invoiceNumber,
      order,
      restaurantGstin: order.restaurant.gstin || null,
      restaurantFssai: order.restaurant.fssaiNumber || null,
      restaurantLegalEntityName: order.restaurant.legalEntityName || null,
      platform: getPlatformTaxProfile(),
    };
  }

  // NOT verified against real GST invoice-numbering rules (which require an unbroken,
  // sequential series per financial year) — this is a reasonable-looking placeholder
  // scheme for development/testing, not something to rely on as-is once actually
  // GST-registered. Confirm the real numbering scheme with an accountant before then.
  private generateInvoiceNumber(order: Order): string {
    const datePart = new Date(order.placedAt).toISOString().slice(0, 10).replace(/-/g, '');
    const orderPart = order.id.slice(0, 8).toUpperCase();
    return `TESTINV-${datePart}-${orderPart}`;
  }

  // How long a restaurant has to accept before the order auto-cancels, and when the
  // halfway nudge fires. Mirrors Zomato/Swiggy's short accept-countdown convention.
  // The restaurant dashboard duplicates ACCEPT_TIMEOUT_SECONDS for its live countdown UI —
  // keep both in sync if this ever changes.
  static readonly ACCEPT_TIMEOUT_MINUTES = 7;
  static readonly NUDGE_AT_MINUTES = OrdersService.ACCEPT_TIMEOUT_MINUTES / 2;

  async updateStatus(
    id: string,
    newStatus: OrderStatus,
    cancelReason: 'customer' | 'restaurant' | 'acceptance_timeout' | null = null,
  ): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id }, relations: { deliveryPartner: true } });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    const allowedNext = ALLOWED_TRANSITIONS[order.status];
    if (!allowedNext.includes(newStatus)) {
      throw new BadRequestException(
        `Cannot move order from "${order.status}" to "${newStatus}". Allowed next: ${allowedNext.join(', ') || 'none'}`,
      );
    }

    order.status = newStatus;
    if (newStatus === OrderStatus.ACCEPTED) order.acceptedAt = new Date();
    if (newStatus === OrderStatus.READY_FOR_PICKUP) order.readyAt = new Date();
    if (newStatus === OrderStatus.PICKED_UP) order.pickedUpAt = new Date();
    if (newStatus === OrderStatus.DELIVERED) {
      order.deliveredAt = new Date();
      // Cash on delivery: handing the order over IS the payment moment — the rider collects
      // at the door, so delivery flips a pending COD order to paid
      if (order.paymentMethod === PaymentMethod.COD && order.paymentStatus === PaymentStatus.PENDING) {
        order.paymentStatus = PaymentStatus.PAID;
      }
    }
    if (newStatus === OrderStatus.CANCELLED) {
      order.cancelReason = cancelReason;
      if (order.paymentStatus === PaymentStatus.PAID) {
        order.refundStatus = RefundStatus.PENDING;
        order.refundAmount = order.total;
      }
    }

    await this.orderRepo.save(order);

    // Free the rider back up once the delivery is finished (or the order is cancelled)
    if ((newStatus === OrderStatus.DELIVERED || newStatus === OrderStatus.CANCELLED) && order.deliveryPartner) {
      await this.deliveryPartnersService.setAvailability(order.deliveryPartner.id, true);
    }

    const updated = await this.findOne(id);

    // Phase G: customer push — same silent-no-op-if-unconfigured/unsubscribed pattern as
    // the existing restaurant/rider pushes above. Deliberately only the three moments a
    // customer actually cares about tracking, not every internal status change (e.g. no
    // push for 'preparing' — that's not actionable news to them).
    const customerUserId = updated.customer?.user?.id;
    if (customerUserId) {
      if (newStatus === OrderStatus.ACCEPTED) {
        this.pushService.sendToSubscriber(customerUserId, 'customer', {
          title: 'Order accepted!',
          body: `${updated.restaurant.name} is preparing your order.`,
        });
      } else if (newStatus === OrderStatus.PICKED_UP) {
        this.pushService.sendToSubscriber(customerUserId, 'customer', {
          title: 'On the way!',
          body: `Your order from ${updated.restaurant.name} is out for delivery.`,
        });
      } else if (newStatus === OrderStatus.DELIVERED) {
        this.pushService.sendToSubscriber(customerUserId, 'customer', {
          title: 'Delivered!',
          body: `Enjoy your order from ${updated.restaurant.name}.`,
        });
      } else if (newStatus === OrderStatus.CANCELLED) {
        this.pushService.sendToSubscriber(customerUserId, 'customer', {
          title: 'Order cancelled',
          body:
            cancelReason === 'acceptance_timeout'
              ? `${updated.restaurant.name} didn't respond in time — you have not been charged.`
              : `Your order from ${updated.restaurant.name} was cancelled.`,
        });
      }
    }

    this.ordersGateway.emitOrderUpdate(id, updated);
    return updated;
  }

  /**
   * Finds the nearest available, verified rider to the restaurant and assigns them to the order.
   * Marks the rider unavailable (busy) so they aren't double-booked while on this delivery.
   */
  async assignRider(orderId: string): Promise<Order> {
    const order = await this.getOrderReadyForRiderAssignment(orderId);

    // Restaurant's location stored as PostGIS geography — extract lat/lng via a raw query
    const coords = await this.orderRepo.manager.query(
      `SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng FROM restaurants WHERE id = $1`,
      [order.restaurant.id],
    );
    const { lat, lng } = coords[0];

    const rider = await this.deliveryPartnersService.findNearestAvailable(lat, lng);
    if (!rider) {
      throw new BadRequestException('No available riders nearby right now — try again shortly');
    }

    return this.finalizeRiderAssignment(order, rider.id);
  }

  /**
   * Manual override — lets the restaurant pick a specific rider from the "available now" list
   * instead of the automatic nearest-match. Same validation, just skips the distance search.
   */
  async assignSpecificRider(orderId: string, riderId: string): Promise<Order> {
    const order = await this.getOrderReadyForRiderAssignment(orderId);
    return this.finalizeRiderAssignment(order, riderId);
  }

  private async getOrderReadyForRiderAssignment(orderId: string): Promise<Order> {
    const order = await this.orderRepo.findOne({ where: { id: orderId }, relations: { restaurant: true } });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (order.deliveryPartner) {
      throw new BadRequestException('This order already has a rider assigned');
    }
    const assignableStatuses = [OrderStatus.ACCEPTED, OrderStatus.PREPARING, OrderStatus.READY_FOR_PICKUP];
    if (!assignableStatuses.includes(order.status)) {
      throw new BadRequestException('Rider can only be assigned once the restaurant has accepted the order');
    }
    return order;
  }

  private async finalizeRiderAssignment(order: Order, riderId: string): Promise<Order> {
    const rider = await this.deliveryPartnersService.findOne(riderId);
    if (!rider.isVerified || !rider.isAvailable) {
      throw new BadRequestException('This rider is not currently available');
    }

    order.deliveryPartner = rider;
    await this.orderRepo.save(order);
    await this.deliveryPartnersService.setAvailability(rider.id, false);

    const updated = await this.findOne(order.id);
    this.ordersGateway.emitOrderUpdate(order.id, updated);
    // Push directly to the rider's personal channel — this is what actually notifies them,
    // since they can't have subscribed to this order's room before knowing it exists.
    this.ordersGateway.emitNewAssignment(rider.id, updated);
    // Also send a real push notification — unlike the socket event above, this reaches the rider
    // even if their browser tab is closed or the phone is asleep.
    this.pushService.sendToSubscriber(rider.id, 'rider', {
      title: 'New delivery!',
      body: `${updated.restaurant.name} · ₹${Number(updated.total).toFixed(0)}`,
    });
    return updated;
  }

  /**
   * Creates a Razorpay order for an existing order so the customer's app can open checkout.
   * Returns what the client needs to launch Razorpay's payment UI (order id, amount, currency).
   */
  async createPayment(orderId: string, userId: string) {
    const order = await this.findOne(orderId, userId); // enforces ownership, throws 403/404 as needed

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('This order has already been paid for');
    }
    if (order.paymentMethod === PaymentMethod.COD) {
      throw new BadRequestException('This is a cash-on-delivery order — pay the rider at the door');
    }

    let razorpayOrder;
    try {
      razorpayOrder = await this.razorpayService.createOrder(Number(order.total), order.id);
    } catch (err: any) {
      const description = err?.error?.description;
      const message =
        description ||
        (err?.statusCode === 401 || err?.statusCode === 403
          ? 'Razorpay rejected the request — RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env are missing or invalid'
          : err?.message || 'unknown error');
      throw new BadRequestException(`Could not create payment with Razorpay: ${message}`);
    }

    order.razorpayOrderId = razorpayOrder.id;
    await this.orderRepo.save(order);

    return {
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
    };
  }

  /**
   * Verifies the signature from a completed Razorpay checkout and marks the order paid.
   * Never trust a client claiming "payment succeeded" without this check passing —
   * it's the only step that actually confirms Razorpay processed the payment.
   */
  async verifyPayment(orderId: string, dto: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (order.razorpayOrderId !== dto.razorpayOrderId) {
      throw new BadRequestException('Razorpay order id does not match this order');
    }

    const isValid = this.razorpayService.verifySignature(
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
    );

    if (!isValid) {
      order.paymentStatus = PaymentStatus.FAILED;
      await this.orderRepo.save(order);
      throw new BadRequestException('Payment signature verification failed');
    }

    order.paymentStatus = PaymentStatus.PAID;
    order.paymentId = dto.razorpayPaymentId;
    await this.orderRepo.save(order);

    const updated = await this.findOne(orderId);
    this.ordersGateway.emitOrderUpdate(orderId, updated);
    return updated;
  }

  /**
   * Customer rates a delivered order — one rating per order, only after delivery, only by the
   * customer who placed it. Updates both the restaurant's and (if assigned) the rider's running
   * average immediately after.
   */
  // Lets the customer app show "Thanks for rating!" instead of the form after a reload —
  // rating state lived only in React state before, so revisiting a rated order re-asked
  // for a rating and resubmission hit the duplicate-rating 400.
  // Public social proof for the customer menu page: recent ratings with comments,
  // customer identified by FIRST NAME ONLY — no phone, no full user object.
  async getRestaurantReviews(restaurantId: string) {
    const ratings = await this.ratingRepo
      .createQueryBuilder('rating')
      .leftJoinAndSelect('rating.order', 'order')
      .leftJoinAndSelect('order.customer', 'customer')
      .leftJoinAndSelect('customer.user', 'user')
      .where('order.restaurantId = :restaurantId', { restaurantId })
      .orderBy('rating.createdAt', 'DESC')
      .take(50)
      .getMany();

    return ratings.map((r) => ({
      id: r.id,
      restaurantRating: r.restaurantRating,
      deliveryRating: r.deliveryRating,
      comment: r.comment,
      createdAt: r.createdAt,
      customerName: (r as any).order?.customer?.user?.name?.split(' ')[0] ?? 'Customer',
      replyText: r.replyText,
      repliedAt: r.repliedAt,
    }));
  }

  /**
   * L3 (restaurant partner dashboard suite): a restaurant replying to a review's comment.
   * Ownership runs through order.restaurant, since Rating has no direct restaurant FK —
   * same pattern as every other order-derived ownership check in this service. Replying
   * again overwrites the previous reply rather than stacking a thread — a review gets one
   * reply, updated in place, matching how Zomato's partner reviews screen behaves.
   */
  async replyToRating(ratingId: string, restaurantId: string, replyText: string) {
    const rating = await this.ratingRepo.findOne({
      where: { id: ratingId },
      relations: { order: { restaurant: true } },
    });
    if (!rating) {
      throw new NotFoundException(`Review ${ratingId} not found`);
    }
    if (rating.order.restaurant.id !== restaurantId) {
      throw new ForbiddenException('You can only reply to reviews of your own restaurant');
    }
    rating.replyText = replyText;
    rating.repliedAt = new Date();
    return this.ratingRepo.save(rating);
  }

  async getOrderRating(orderId: string, userId: string) {
    await this.findOne(orderId, userId); // enforces ownership
    const rating = await this.ratingRepo.findOne({ where: { order: { id: orderId } } });
    return { rated: Boolean(rating), rating };
  }

  async rateOrder(orderId: string, userId: string, dto: CreateRatingDto): Promise<Rating> {
    const order = await this.findOne(orderId, userId); // enforces ownership, throws 403/404 as needed

    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException('You can only rate an order after it has been delivered');
    }

    const existing = await this.ratingRepo.findOne({ where: { order: { id: orderId } } });
    if (existing) {
      throw new BadRequestException('This order has already been rated');
    }

    const rating = await this.ratingRepo.save(
      this.ratingRepo.create({
        order: { id: orderId } as Order,
        restaurantRating: dto.restaurantRating,
        deliveryRating: dto.deliveryRating,
        comment: dto.comment,
      }),
    );

    await this.recomputeRestaurantRating(order.restaurant.id);
    if (order.deliveryPartner) {
      await this.recomputeRiderRating(order.deliveryPartner.id);
    }

    return rating;
  }

  /**
   * A customer can file a complaint against any order that's actually finished (delivered
   * or cancelled) — an order still in flight has other tools for that (cancel, contacting
   * the restaurant), and "complaint" specifically means something already happened that
   * needs following up on. Unlike ratings, multiple complaints per order are allowed — a
   * missing item and a quality issue are genuinely separate things worth tracking on their
   * own, not edits to one review.
   */
  async fileComplaint(orderId: string, userId: string, dto: CreateComplaintDto): Promise<Complaint> {
    const order = await this.findOne(orderId, userId); // enforces ownership, throws 403/404 as needed

    if (order.status !== OrderStatus.DELIVERED && order.status !== OrderStatus.CANCELLED) {
      throw new BadRequestException('You can only file a complaint once an order has been delivered or cancelled');
    }

    return this.complaintRepo.save(
      this.complaintRepo.create({
        order: { id: orderId } as Order,
        category: dto.category,
        description: dto.description,
      }),
    );
  }

  async getMyComplaints(userId: string): Promise<Complaint[]> {
    return this.complaintRepo.find({
      where: { order: { customer: { user: { id: userId } } } },
      relations: { order: { restaurant: true } },
      order: { createdAt: 'DESC' },
    });
  }

  async getRestaurantComplaints(restaurantId: string): Promise<Complaint[]> {
    return this.complaintRepo.find({
      where: { order: { restaurant: { id: restaurantId } } },
      relations: { order: { customer: { user: true } } },
      order: { createdAt: 'DESC' },
    });
  }

  async getAllComplaintsForAdmin(): Promise<Complaint[]> {
    return this.complaintRepo.find({
      relations: { order: { restaurant: true, customer: { user: true } } },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Restaurant responds to a complaint against one of their own orders. Ownership runs
   * through complaint.order.restaurant, same pattern as replyToRating — Complaint has no
   * direct restaurant FK of its own. Responding again overwrites the previous response
   * rather than stacking a thread, matching how replies work everywhere else in this app.
   */
  async respondToComplaintAsRestaurant(complaintId: string, restaurantId: string, dto: RespondToComplaintDto): Promise<Complaint> {
    const complaint = await this.complaintRepo.findOne({
      where: { id: complaintId },
      relations: { order: { restaurant: true } },
    });
    if (!complaint) {
      throw new NotFoundException(`Complaint ${complaintId} not found`);
    }
    if (complaint.order.restaurant.id !== restaurantId) {
      throw new ForbiddenException('You can only respond to complaints about your own restaurant');
    }
    return this.applyComplaintResponse(complaint, dto);
  }

  // Admin can update/resolve any complaint platform-wide — no ownership check needed,
  // authorization already happened at the controller (role === 'admin')
  async respondToComplaintAsAdmin(complaintId: string, dto: RespondToComplaintDto): Promise<Complaint> {
    const complaint = await this.complaintRepo.findOne({ where: { id: complaintId } });
    if (!complaint) {
      throw new NotFoundException(`Complaint ${complaintId} not found`);
    }
    return this.applyComplaintResponse(complaint, dto);
  }

  private async applyComplaintResponse(complaint: Complaint, dto: RespondToComplaintDto): Promise<Complaint> {
    if (dto.responseText) {
      complaint.restaurantResponse = dto.responseText;
      complaint.respondedAt = new Date();
    }
    if (dto.status) {
      complaint.status = dto.status;
      if (dto.status === 'resolved') {
        complaint.resolvedAt = new Date();
      }
    }
    return this.complaintRepo.save(complaint);
  }

  private async recomputeRestaurantRating(restaurantId: string): Promise<void> {
    const result = await this.orderRepo.manager.query(
      `SELECT AVG(r."restaurantRating") as avg, COUNT(*) as count
       FROM ratings r
       JOIN orders o ON o.id = r."orderId"
       WHERE o."restaurantId" = $1`,
      [restaurantId],
    );
    const avg = parseFloat(result[0].avg) || 0;
    const count = parseInt(result[0].count) || 0;
    await this.restaurantsService.setRatingStats(restaurantId, Math.round(avg * 100) / 100, count);
  }

  private async recomputeRiderRating(riderId: string): Promise<void> {
    const result = await this.orderRepo.manager.query(
      `SELECT AVG(r."deliveryRating") as avg, COUNT(*) as count
       FROM ratings r
       JOIN orders o ON o.id = r."orderId"
       WHERE o."deliveryPartnerId" = $1`,
      [riderId],
    );
    const avg = parseFloat(result[0].avg) || 0;
    const count = parseInt(result[0].count) || 0;
    await this.deliveryPartnersService.setRatingStats(riderId, Math.round(avg * 100) / 100, count);
  }

  /**
   * One-time backfill — recalculates ratingAvg/ratingCount for every restaurant and rider that
   * has any rating history, from scratch. Needed once after adding ratingCount as a new column,
   * since existing ratings never triggered a recompute against a column that didn't exist yet.
   * Safe to re-run any time; it always reflects true historical totals, never double-counts.
   */
  async backfillAllRatingStats(): Promise<{ restaurantsUpdated: number; ridersUpdated: number }> {
    const restaurantIds = await this.orderRepo.manager.query(
      `SELECT DISTINCT o."restaurantId" FROM ratings r JOIN orders o ON o.id = r."orderId"`,
    );
    for (const row of restaurantIds) {
      await this.recomputeRestaurantRating(row.restaurantId);
    }

    const riderIds = await this.orderRepo.manager.query(
      `SELECT DISTINCT o."deliveryPartnerId" FROM ratings r JOIN orders o ON o.id = r."orderId" WHERE o."deliveryPartnerId" IS NOT NULL`,
    );
    for (const row of riderIds) {
      await this.recomputeRiderRating(row.deliveryPartnerId);
    }

    return { restaurantsUpdated: restaurantIds.length, ridersUpdated: riderIds.length };
  }

  /**
   * Rider earnings — modeled as the flat delivery fee per completed delivery. Now split into
   * "pending payout" (delivered, not yet paid out) and "already paid out", so a rider can see
   * exactly what they're still owed versus what's already been settled.
   */
  async getRiderEarnings(riderId: string) {
    const deliveredOrders = await this.orderRepo.find({
      where: { deliveryPartner: { id: riderId }, status: OrderStatus.DELIVERED },
      relations: { restaurant: true, payout: true },
      order: { deliveredAt: 'DESC' },
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let lifetimeTotal = 0;
    let todayTotal = 0;
    let pendingPayout = 0;
    const history = deliveredOrders.map((order) => {
      // The tip is the rider's, never the platform's — added here, never touched by
      // commission math, which only ever applies to the restaurant's subtotal.
      const amount = Number(order.deliveryFee) + Number(order.tipAmount || 0);
      lifetimeTotal += amount;
      if (order.deliveredAt && order.deliveredAt >= startOfToday) {
        todayTotal += amount;
      }
      if (!order.payout) {
        pendingPayout += amount;
      }
      return {
        orderId: order.id,
        restaurantName: order.restaurant.name,
        amount,
        deliveryFee: Number(order.deliveryFee),
        tipAmount: Number(order.tipAmount || 0),
        deliveredAt: order.deliveredAt,
        paidOut: !!order.payout,
      };
    });

    const payouts = await this.payoutRepo.find({
      where: { deliveryPartner: { id: riderId } },
      order: { createdAt: 'DESC' },
    });

    return {
      lifetimeTotal: Math.round(lifetimeTotal * 100) / 100,
      todayTotal: Math.round(todayTotal * 100) / 100,
      pendingPayout: Math.round(pendingPayout * 100) / 100,
      deliveryCount: deliveredOrders.length,
      history,
      payouts: payouts.map((p) => ({ id: p.id, amount: Number(p.amount), createdAt: p.createdAt })),
    };
  }

  /**
   * Admin-only — settles all of a rider's currently-unpaid delivered orders into a single
   * payout record. Safe to run repeatedly: only ever touches orders with no payout attached yet,
   * so it can never double-pay the same delivery.
   */
  async createPayout(riderId: string) {
    const unpaidOrders = await this.orderRepo.find({
      where: { deliveryPartner: { id: riderId }, status: OrderStatus.DELIVERED, payout: IsNull() },
    });

    if (unpaidOrders.length === 0) {
      throw new BadRequestException('This rider has no pending earnings to pay out');
    }

    const totalAmount = unpaidOrders.reduce((sum, o) => sum + Number(o.deliveryFee), 0);

    const payout = await this.payoutRepo.save(
      this.payoutRepo.create({
        deliveryPartner: { id: riderId } as any,
        amount: Math.round(totalAmount * 100) / 100,
      }),
    );

    await this.orderRepo.update(
      { id: In(unpaidOrders.map((o) => o.id)) },
      { payout: { id: payout.id } as any },
    );

    return { payoutId: payout.id, amount: payout.amount, ordersSettled: unpaidOrders.length };
  }

  /**
   * Restaurant intelligence — the kind of operational visibility Swiggy/Zomato keep for their
   * own internal ops dashboards, not typically shown transparently to the restaurant itself.
   * Everything here is computed from the restaurant's own order history, no external data needed.
   */
  async getRestaurantInsights(restaurantId: string) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Revenue + order counts, lifetime and today — DELIVERED orders only, so cancelled/in-flight
    // orders don't inflate "revenue you've actually earned"
    const revenueRows = await this.orderRepo.manager.query(
      `SELECT
         COALESCE(SUM(subtotal), 0) as lifetime_revenue,
         COUNT(*) as lifetime_orders,
         COALESCE(SUM(subtotal) FILTER (WHERE "deliveredAt" >= $2), 0) as today_revenue,
         COUNT(*) FILTER (WHERE "deliveredAt" >= $2) as today_orders
       FROM orders
       WHERE "restaurantId" = $1 AND status = 'delivered'`,
      [restaurantId, startOfToday],
    );
    const revenue = revenueRows[0];

    // Top-selling items by quantity — helps a restaurant see what's actually working,
    // not just guess from memory
    const topItems = await this.orderRepo.manager.query(
      `SELECT mi.name, SUM(oi.quantity) as total_quantity
       FROM order_items oi
       JOIN orders o ON o.id = oi."orderId"
       JOIN menu_items mi ON mi.id = oi."menuItemId"
       WHERE o."restaurantId" = $1 AND o.status = 'delivered'
       GROUP BY mi.name
       ORDER BY total_quantity DESC
       LIMIT 5`,
      [restaurantId],
    );

    // Orders by hour of day (0-23), lifetime — reveals actual peak hours from real data,
    // not assumption. Frontend renders this as a simple bar chart.
    const hourlyRows = await this.orderRepo.manager.query(
      `SELECT EXTRACT(HOUR FROM "placedAt") as hour, COUNT(*) as order_count
       FROM orders
       WHERE "restaurantId" = $1
       GROUP BY hour
       ORDER BY hour`,
      [restaurantId],
    );
    const ordersByHour = Array.from({ length: 24 }, (_, hour) => {
      const row = hourlyRows.find((r: any) => parseInt(r.hour) === hour);
      return { hour, count: row ? parseInt(row.order_count) : 0 };
    });

    // Accountability metrics — how fast does this restaurant actually accept and prepare
    // orders, versus what they claim (avgPrepTimeMins)? This is exactly the kind of thing
    // platforms track internally but rarely show restaurants about themselves.
    const timingRows = await this.orderRepo.manager.query(
      `SELECT
         AVG(EXTRACT(EPOCH FROM ("acceptedAt" - "placedAt")) / 60) as avg_accept_minutes,
         AVG(EXTRACT(EPOCH FROM ("readyAt" - "acceptedAt")) / 60) as avg_prep_minutes
       FROM orders
       WHERE "restaurantId" = $1 AND "acceptedAt" IS NOT NULL`,
      [restaurantId],
    );
    const timing = timingRows[0];

    return {
      lifetimeRevenue: Math.round(Number(revenue.lifetime_revenue) * 100) / 100,
      lifetimeOrders: parseInt(revenue.lifetime_orders),
      todayRevenue: Math.round(Number(revenue.today_revenue) * 100) / 100,
      todayOrders: parseInt(revenue.today_orders),
      topItems: topItems.map((r: any) => ({ name: r.name, quantity: parseInt(r.total_quantity) })),
      ordersByHour,
      avgAcceptMinutes: timing.avg_accept_minutes ? Math.round(Number(timing.avg_accept_minutes) * 10) / 10 : null,
      avgPrepMinutes: timing.avg_prep_minutes ? Math.round(Number(timing.avg_prep_minutes) * 10) / 10 : null,
      weekOverWeek: await this.getWeekOverWeek(restaurantId),
      cancellationRate: await this.getCancellationRate(restaurantId),
      repeatCustomerRate: await this.getRepeatCustomerRate(restaurantId),
      discountEffectiveness: await this.getDiscountEffectiveness(restaurantId),
    };
  }

  // Rolling 7-day windows rather than calendar weeks — avoids Monday/Sunday ambiguity and is
  // more actionable ("compared to the last 7 days" is always meaningful, regardless of today's date)
  private async getWeekOverWeek(restaurantId: string) {
    const rows = await this.orderRepo.manager.query(
      `SELECT
         COALESCE(SUM(subtotal) FILTER (WHERE "deliveredAt" >= now() - interval '7 days'), 0) as this_week_revenue,
         COUNT(*) FILTER (WHERE "deliveredAt" >= now() - interval '7 days') as this_week_orders,
         COALESCE(SUM(subtotal) FILTER (WHERE "deliveredAt" >= now() - interval '14 days' AND "deliveredAt" < now() - interval '7 days'), 0) as last_week_revenue,
         COUNT(*) FILTER (WHERE "deliveredAt" >= now() - interval '14 days' AND "deliveredAt" < now() - interval '7 days') as last_week_orders
       FROM orders
       WHERE "restaurantId" = $1 AND status = 'delivered'`,
      [restaurantId],
    );
    const r = rows[0];
    const thisWeekRevenue = Math.round(Number(r.this_week_revenue) * 100) / 100;
    const lastWeekRevenue = Math.round(Number(r.last_week_revenue) * 100) / 100;
    const pctChange = lastWeekRevenue > 0 ? Math.round(((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 1000) / 10 : null;
    return {
      thisWeekRevenue,
      lastWeekRevenue,
      thisWeekOrders: parseInt(r.this_week_orders),
      lastWeekOrders: parseInt(r.last_week_orders),
      pctChange,
    };
  }

  // What % of orders end up cancelled rather than delivered — an honesty metric most platforms
  // track internally but don't hand back to the restaurant itself
  private async getCancellationRate(restaurantId: string) {
    const rows = await this.orderRepo.manager.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
         COUNT(*) FILTER (WHERE status IN ('cancelled', 'delivered')) as total
       FROM orders
       WHERE "restaurantId" = $1`,
      [restaurantId],
    );
    const r = rows[0];
    const total = parseInt(r.total);
    return total > 0 ? Math.round((parseInt(r.cancelled) / total) * 1000) / 10 : 0;
  }

  // % of this restaurant's customers who have ordered more than once — a genuine loyalty signal
  // that isn't typically surfaced to restaurants on major platforms at all
  private async getRepeatCustomerRate(restaurantId: string) {
    const rows = await this.orderRepo.manager.query(
      `SELECT
         COUNT(*) as total_customers,
         COUNT(*) FILTER (WHERE order_count > 1) as repeat_customers
       FROM (
         SELECT "customerId", COUNT(*) as order_count
         FROM orders
         WHERE "restaurantId" = $1
         GROUP BY "customerId"
       ) per_customer`,
      [restaurantId],
    );
    const r = rows[0];
    const totalCustomers = parseInt(r.total_customers);
    return totalCustomers > 0 ? Math.round((parseInt(r.repeat_customers) / totalCustomers) * 1000) / 10 : 0;
  }

  /**
   * L4: does this restaurant's discounting actually work, or is it just giving away margin
   * on orders that would have happened anyway? Two pieces: per-offer performance (so a
   * restaurant can see which specific offers pull their weight), and the one question that
   * actually answers "effectiveness" — is the average order value genuinely higher on
   * orders that used an offer than on ones that didn't? Revenue/AOV both use `subtotal`,
   * matching every other insights metric above, and both stay scoped to delivered orders —
   * a redemption on a cancelled order never actually became real revenue.
   */
  private async getDiscountEffectiveness(restaurantId: string) {
    const perOfferRows = await this.orderRepo.manager.query(
      `SELECT
         o.id, o.name, o.code, o.active,
         COUNT(red.id) as redemption_count,
         COALESCE(SUM(red."discountAmount"), 0) as total_discount_given,
         COALESCE(SUM(ord.subtotal) FILTER (WHERE ord.status = 'delivered'), 0) as revenue_from_offer,
         COALESCE(AVG(ord.subtotal) FILTER (WHERE ord.status = 'delivered'), 0) as avg_order_value
       FROM offers o
       LEFT JOIN offer_redemptions red ON red."offerId" = o.id
       LEFT JOIN orders ord ON ord.id = red."orderId"
       WHERE o."restaurantId" = $1
       GROUP BY o.id, o.name, o.code, o.active
       ORDER BY redemption_count DESC`,
      [restaurantId],
    );

    const comparisonRows = await this.orderRepo.manager.query(
      `SELECT
         AVG(ord.subtotal) FILTER (WHERE red.id IS NOT NULL) as avg_with_offer,
         AVG(ord.subtotal) FILTER (WHERE red.id IS NULL) as avg_without_offer,
         COUNT(*) FILTER (WHERE red.id IS NOT NULL) as orders_with_offer,
         COUNT(*) as total_orders
       FROM orders ord
       LEFT JOIN offer_redemptions red ON red."orderId" = ord.id
       WHERE ord."restaurantId" = $1 AND ord.status = 'delivered'`,
      [restaurantId],
    );
    const c = comparisonRows[0];
    const avgWithOffer = c.avg_with_offer !== null ? Math.round(Number(c.avg_with_offer) * 100) / 100 : null;
    const avgWithoutOffer = c.avg_without_offer !== null ? Math.round(Number(c.avg_without_offer) * 100) / 100 : null;

    return {
      perOffer: perOfferRows.map((row: any) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        active: row.active,
        redemptionCount: parseInt(row.redemption_count),
        totalDiscountGiven: Math.round(Number(row.total_discount_given) * 100) / 100,
        revenueFromOffer: Math.round(Number(row.revenue_from_offer) * 100) / 100,
        avgOrderValue: Math.round(Number(row.avg_order_value) * 100) / 100,
      })),
      avgOrderValueWithOffer: avgWithOffer,
      avgOrderValueWithoutOffer: avgWithoutOffer,
      // Null rather than 0 when there's not enough data either side to compare honestly —
      // a restaurant with zero non-offer orders can't meaningfully answer "does it help"
      liftPercent:
        avgWithOffer !== null && avgWithoutOffer !== null && avgWithoutOffer > 0
          ? Math.round(((avgWithOffer - avgWithoutOffer) / avgWithoutOffer) * 1000) / 10
          : null,
      ordersWithOffer: parseInt(c.orders_with_offer),
      totalOrders: parseInt(c.total_orders),
    };
  }

  /**
   * Admin marks a pending refund as completed — for now, this only updates our own records.
   *
   * TODO once Razorpay is fully live: call Razorpay's refund API here
   * (razorpay.payments.refund(order.paymentId, { amount: order.refundAmount * 100 })) before
   * marking this completed, so the money actually moves. Right now this just tracks that a
   * human handled the refund manually/externally.
   */
  async completeRefund(orderId: string): Promise<Order> {
    const order = await this.findOne(orderId);
    if (order.refundStatus !== RefundStatus.PENDING) {
      throw new BadRequestException('This order has no pending refund to complete');
    }
    order.refundStatus = RefundStatus.COMPLETED;
    await this.orderRepo.save(order);
    return this.findOne(orderId);
  }

  /**
   * Acceptance-timeout sweep. Runs every 30s (cheap: PLACED orders are rare and short-lived
   * by design). Two independent passes:
   *  1. Nudge — orders past the halfway mark get a one-time "about to expire" push to the
   *     restaurant's live dashboard, so a distracted kitchen gets a second chance.
   *  2. Auto-cancel — orders past the full timeout are cancelled exactly like a manual
   *     cancellation (reusing updateStatus, so refund-flagging and rider-release logic
   *     can't drift between the two paths), tagged with cancelReason: 'acceptance_timeout'.
   * Both queries are cheap indexed scans over a small, self-limiting set: an order leaves
   * PLACED (via accept or cancel) well before it could accumulate.
   */
  @Cron('*/30 * * * * *')
  async sweepAcceptanceTimeouts() {
    await this.nudgeExpiringOrders();
    await this.autoCancelStaleOrders();
  }

  /**
   * Phase F: a restaurant that clicks "Auto-assign nearest" and gets "no riders nearby"
   * shouldn't have to keep clicking — this sweep retries automatically every 45s for any
   * order sitting ready-for-pickup with no rider yet. Reuses assignRider() itself, so a
   * successful retry emits the exact same order-update + rider-push events as a manual
   * click; nothing about "how an order gets a rider" forks between the two paths.
   * Orders past READY_STUCK_MINUTES unassigned are left for a human — see staleUnassignedOrders().
   */
  @Cron('*/45 * * * * *')
  async retryUnassignedReadyOrders(): Promise<void> {
    // relations: restaurant is required — assignRider() reads order.restaurant.id to locate
    // the restaurant's coordinates, and silently omitting it here previously turned every
    // retry attempt into a swallowed TypeError instead of the expected "no rider" case
    const candidates = await this.orderRepo.find({
      where: { status: OrderStatus.READY_FOR_PICKUP, deliveryPartner: IsNull() },
      relations: { restaurant: true },
      order: { placedAt: 'ASC' }, // fair queueing within the same tier
    });
    // Express genuinely jumps the queue here — the honest, buildable version of "faster"
    // with one shared rider pool: no dedicated Express riders, but real priority when
    // multiple orders are competing for the same available rider. A plain 'ASC' sort on
    // the deliveryType column would sort alphabetically ("eco" < "express" < "standard"),
    // the OPPOSITE of what's wanted — so this sorts by the actual configured priority
    // weight instead, with placedAt as the tiebreaker within the same tier.
    candidates.sort((a, b) => DELIVERY_TYPE_CONFIG[a.deliveryType].priorityWeight - DELIVERY_TYPE_CONFIG[b.deliveryType].priorityWeight);
    for (const order of candidates) {
      try {
        await this.assignRider(order.id);
      } catch (err) {
        if (err instanceof BadRequestException) continue; // genuinely no rider nearby — try again next sweep
        throw err; // anything else is a real bug and shouldn't be swallowed
      }
    }
  }

  // How long an order can sit ready-for-pickup with no rider before it's surfaced to admin
  // as needing a human to intervene (call a rider directly, call the restaurant, etc.)
  static readonly READY_STUCK_MINUTES = 5;

  /** Powers the admin panel's "Needs a rider" list. Read-only visibility — no auto-action here. */
  async staleUnassignedOrders(): Promise<Order[]> {
    const threshold = new Date(Date.now() - OrdersService.READY_STUCK_MINUTES * 60_000);
    return this.orderRepo.find({
      where: { status: OrderStatus.READY_FOR_PICKUP, deliveryPartner: IsNull(), readyAt: LessThan(threshold) },
      relations: { restaurant: true, customer: { user: true } },
      order: { readyAt: 'ASC' },
    });
  }

  async nudgeExpiringOrders(): Promise<void> {
    const nudgeThreshold = new Date(Date.now() - OrdersService.NUDGE_AT_MINUTES * 60_000);
    const candidates = await this.orderRepo.find({
      where: { status: OrderStatus.PLACED, expiryNudgeSentAt: IsNull() },
      relations: { restaurant: true },
    });
    for (const order of candidates) {
      if (order.placedAt > nudgeThreshold) continue; // not halfway yet
      order.expiryNudgeSentAt = new Date();
      await this.orderRepo.save(order);
      const secondsRemaining = Math.max(
        0,
        OrdersService.ACCEPT_TIMEOUT_MINUTES * 60 - Math.floor((Date.now() - order.placedAt.getTime()) / 1000),
      );
      this.ordersGateway.emitOrderExpiringSoon(order.restaurant.id, { orderId: order.id, secondsRemaining });
    }
  }

  async autoCancelStaleOrders(): Promise<void> {
    const deadline = new Date(Date.now() - OrdersService.ACCEPT_TIMEOUT_MINUTES * 60_000);
    const stale = await this.orderRepo.find({ where: { status: OrderStatus.PLACED } });
    for (const order of stale) {
      if (order.placedAt > deadline) continue; // not timed out yet
      await this.updateStatus(order.id, OrderStatus.CANCELLED, 'acceptance_timeout');
    }
  }
}
