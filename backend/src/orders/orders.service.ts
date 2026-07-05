import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Order, OrderStatus, PaymentStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Rating } from './entities/rating.entity';
import { Restaurant, RestaurantStatus } from '../restaurants/entities/restaurant.entity';
import { MenuItem } from '../menu-items/entities/menu-item.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateRatingDto } from './dto/create-rating.dto';
import { DeliveryPartnersService } from '../delivery-partners/delivery-partners.service';
import { RestaurantsService } from '../restaurants/restaurants.service';
import { OrdersGateway } from './orders.gateway';
import { RazorpayService } from '../payments/razorpay.service';

// Flat delivery fee for MVP — replace with distance-based calculation once rider assignment exists
const FLAT_DELIVERY_FEE = 30;

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
    private readonly deliveryPartnersService: DeliveryPartnersService,
    private readonly restaurantsService: RestaurantsService,
    private readonly ordersGateway: OrdersGateway,
    private readonly razorpayService: RazorpayService,
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

    const menuItemIds = dto.items.map((i) => i.menuItemId);
    const menuItems = await this.menuItemRepo.find({
      where: { id: In(menuItemIds) },
      relations: { restaurant: true },
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

      const priceAtOrder = Number(menuItem.price);
      subtotal += priceAtOrder * requested.quantity;

      const orderItem = new OrderItem();
      orderItem.menuItem = menuItem;
      orderItem.quantity = requested.quantity;
      orderItem.priceAtOrder = priceAtOrder;
      orderItem.notes = requested.notes ?? null;
      orderItems.push(orderItem);
    }

    const commissionAmount = Math.round(subtotal * (Number(restaurant.commissionRate) / 100) * 100) / 100;
    const total = subtotal + FLAT_DELIVERY_FEE;

    // Rough ETA: restaurant's stated prep time + a distance-based travel estimate.
    // Assumes ~20km/h average city delivery speed — doesn't account for real traffic,
    // so treat this as a reasonable estimate shown to the customer, not a guarantee.
    const AVG_DELIVERY_SPEED_MPS = 5.56;
    const distanceRow = await this.orderRepo.manager.query(
      `SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)) as dist FROM restaurants WHERE id = $3`,
      [dto.longitude, dto.latitude, restaurant.id],
    );
    const distanceMeters = parseFloat(distanceRow[0].dist);
    const travelSeconds = distanceMeters / AVG_DELIVERY_SPEED_MPS;
    const prepSeconds = restaurant.avgPrepTimeMins * 60;
    const estimatedDeliveryAt = new Date(Date.now() + (prepSeconds + travelSeconds) * 1000);

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
        deliveryAddress: dto.deliveryAddress,
        deliveryLocation: () => `ST_SetSRID(ST_MakePoint(${dto.longitude}, ${dto.latitude}), 4326)`,
        subtotal,
        deliveryFee: FLAT_DELIVERY_FEE,
        commissionAmount,
        total,
        estimatedDeliveryAt,
      } as any)
      .returning('*')
      .execute();

    const savedOrderId = insertResult.raw[0].id;

    // Now attach order items referencing the saved order id
    for (const item of orderItems) {
      item.order = { id: savedOrderId } as Order;
    }
    await this.orderRepo.manager.getRepository(OrderItem).save(orderItems);

    const created = await this.findOne(savedOrderId);
    // Push directly to the restaurant's personal channel — this is what actually notifies them
    // of a brand new order, since they can't have subscribed to this order's room before it existed.
    this.ordersGateway.emitNewOrder(restaurant.id, created);
    return created;
  }

  async findAllForCustomer(userId: string): Promise<Order[]> {
    const customer = await this.customerRepo.findOne({ where: { user: { id: userId } } });
    if (!customer) {
      throw new NotFoundException('Customer profile not found for this account');
    }

    return this.orderRepo.find({
      where: { customer: { id: customer.id } },
      relations: { restaurant: true, items: { menuItem: true } },
      order: { placedAt: 'DESC' },
    });
  }

  // Restaurant-owner facing — lists orders placed AT their restaurant, not orders they placed as a customer
  async findAllForRestaurant(restaurantId: string): Promise<Order[]> {
    return this.orderRepo.find({
      where: { restaurant: { id: restaurantId } },
      relations: { customer: { user: true }, items: { menuItem: true }, deliveryPartner: true },
      order: { placedAt: 'DESC' },
    });
  }

  // Rider facing — lists orders currently assigned to this rider
  async findAllForRider(riderId: string): Promise<Order[]> {
    return this.orderRepo.find({
      where: { deliveryPartner: { id: riderId } },
      relations: { restaurant: true, customer: { user: true }, items: { menuItem: true } },
      order: { placedAt: 'DESC' },
    });
  }

  async findOne(id: string, requestingUserId?: string): Promise<Order> {
    const order = await this.orderRepo.findOne({
      where: { id },
      relations: { restaurant: true, customer: { user: true }, items: { menuItem: true }, deliveryPartner: true },
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

  async updateStatus(id: string, newStatus: OrderStatus): Promise<Order> {
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
    if (newStatus === OrderStatus.DELIVERED) order.deliveredAt = new Date();

    await this.orderRepo.save(order);

    // Free the rider back up once the delivery is finished (or the order is cancelled)
    if ((newStatus === OrderStatus.DELIVERED || newStatus === OrderStatus.CANCELLED) && order.deliveryPartner) {
      await this.deliveryPartnersService.setAvailability(order.deliveryPartner.id, true);
    }

    const updated = await this.findOne(id);
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

  private async recomputeRestaurantRating(restaurantId: string): Promise<void> {
    const result = await this.orderRepo.manager.query(
      `SELECT AVG(r."restaurantRating") as avg
       FROM ratings r
       JOIN orders o ON o.id = r."orderId"
       WHERE o."restaurantId" = $1`,
      [restaurantId],
    );
    const avg = parseFloat(result[0].avg) || 0;
    await this.restaurantsService.setRatingAvg(restaurantId, Math.round(avg * 100) / 100);
  }

  private async recomputeRiderRating(riderId: string): Promise<void> {
    const result = await this.orderRepo.manager.query(
      `SELECT AVG(r."deliveryRating") as avg
       FROM ratings r
       JOIN orders o ON o.id = r."orderId"
       WHERE o."deliveryPartnerId" = $1`,
      [riderId],
    );
    const avg = parseFloat(result[0].avg) || 0;
    await this.deliveryPartnersService.setRatingAvg(riderId, Math.round(avg * 100) / 100);
  }

  /**
   * Rider earnings — currently modeled as the flat delivery fee per completed delivery.
   * Returns lifetime total, today's total, and the underlying list of delivered orders.
   */
  async getRiderEarnings(riderId: string) {
    const deliveredOrders = await this.orderRepo.find({
      where: { deliveryPartner: { id: riderId }, status: OrderStatus.DELIVERED },
      relations: { restaurant: true },
      order: { deliveredAt: 'DESC' },
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let lifetimeTotal = 0;
    let todayTotal = 0;
    const history = deliveredOrders.map((order) => {
      const amount = Number(order.deliveryFee);
      lifetimeTotal += amount;
      if (order.deliveredAt && order.deliveredAt >= startOfToday) {
        todayTotal += amount;
      }
      return {
        orderId: order.id,
        restaurantName: order.restaurant.name,
        amount,
        deliveredAt: order.deliveredAt,
      };
    });

    return {
      lifetimeTotal: Math.round(lifetimeTotal * 100) / 100,
      todayTotal: Math.round(todayTotal * 100) / 100,
      deliveryCount: deliveredOrders.length,
      history,
    };
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
}
