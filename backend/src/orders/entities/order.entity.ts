import { Column, CreateDateColumn, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { Restaurant } from '../../restaurants/entities/restaurant.entity';
import { DeliveryPartner } from '../../delivery-partners/entities/delivery-partner.entity';
import { Payout } from '../../delivery-partners/entities/payout.entity';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  PLACED = 'placed',
  ACCEPTED = 'accepted',
  PREPARING = 'preparing',
  READY_FOR_PICKUP = 'ready_for_pickup',
  PICKED_UP = 'picked_up',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export enum PaymentMethod {
  ONLINE = 'online',
  COD = 'cod', // cash on delivery — the rider collects at the door
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export enum RefundStatus {
  NONE = 'none',
  PENDING = 'pending',
  COMPLETED = 'completed',
}

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Customer)
  customer: Customer;

  @ManyToOne(() => Restaurant)
  restaurant: Restaurant;

  @ManyToOne(() => DeliveryPartner, { nullable: true })
  deliveryPartner: DeliveryPartner | null;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PLACED })
  status: OrderStatus;

  @Column()
  deliveryAddress: string;

  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  deliveryLocation: string;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  deliveryFee: number;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  commissionAmount: number;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  total: number;

  @Column({ type: 'enum', enum: PaymentStatus, default: PaymentStatus.PENDING })
  paymentStatus: PaymentStatus;

  // How the customer chose to pay. COD needs no gateway: the order stays payment-pending
  // until the rider hands it over, at which point delivery flips it to paid (cash at door).
  @Column({ type: 'varchar', default: PaymentMethod.ONLINE })
  paymentMethod: PaymentMethod;

  // Optional cooking note from the customer ("less spicy", "no onions") — shown to the
  // kitchen on the live order card
  @Column({ type: 'varchar', length: 300, nullable: true })
  instructions: string | null;

  // Opt-IN, not opt-out — defaults to false so cutlery isn't sent unless asked for,
  // matching the increasingly common "reduce plastic waste" pattern real apps use.
  @Column({ default: false })
  cutleryNeeded: boolean;

  // Express/Standard/Eco — see delivery-type.util.ts for the surcharge and real dispatch
  // priority each tier gets.
  @Column({ type: 'varchar', default: 'standard' })
  deliveryType: 'standard' | 'express' | 'eco';

  // For the rider, not the platform — added to their earnings in getRiderEarnings(),
  // never touched by commission math.
  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  tipAmount: number;

  // Platform fee + packaging fee + GST — see gst-config.util.ts. Always server-computed
  // from config, NEVER accepted from the client (unlike deliveryType/tipAmount, which are
  // real customer choices). All default to 0 and stay 0 until explicitly enabled — see
  // that file for why.
  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  platformFeeAmount: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  packagingFeeAmount: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  restaurantGstAmount: number;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  deliveryGstAmount: number;

  // Assigned once — the first time GET /orders/:id/tax-invoice is called for this order —
  // and never changed after (see generateInvoiceNumber() in orders.service.ts). Real GST
  // rules require sequential, gap-free numbering within a declared series; this scheme is
  // a reasonable placeholder shape, NOT verified against an accountant — confirm the real
  // numbering scheme before this goes live, same caveat as gst-config.util.ts's rates.
  @Column({ type: 'varchar', nullable: true })
  invoiceNumber: string | null;

  // Who/what cancelled the order — lets both apps show an honest reason instead of a bare
  // "cancelled" pill. Null for every non-cancelled order.
  @Column({ type: 'varchar', nullable: true })
  cancelReason: 'customer' | 'restaurant' | 'acceptance_timeout' | null;

  // Snapshot of an applied offer (L1) — name/amount survive the offer being edited or
  // deleted later, same principle as priceAtOrder. Null when no offer applied.
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  discountAmount: number | null;

  @Column({ type: 'varchar', nullable: true })
  appliedOfferName: string | null;

  // "Schedule for later" — deliberately minimal scope: this records what the customer
  // asked for and shows it to the restaurant/rider, but doesn't (yet) auto-trigger
  // anything at that time. Acceptance, prep, and dispatch stay exactly as manual as
  // every other order today. Null means "as soon as possible" (today's only behavior).
  @Column({ type: 'timestamptz', nullable: true })
  scheduledFor: Date | null;

  // Set the moment the halfway-to-timeout nudge fires, so the cron sends it exactly once
  // per order rather than every time it sweeps
  @Column({ type: 'timestamptz', nullable: true })
  expiryNudgeSentAt: Date | null;

  // Set when create-payment is called, before the customer actually pays
  @Column({ nullable: true })
  razorpayOrderId: string;

  // Razorpay payment reference — set only after successful payment verification
  @Column({ nullable: true })
  paymentId: string;

  // Computed once at order creation from prep time + estimated travel time — a rough ETA,
  // not re-calculated as the order progresses (real traffic/prep variance isn't modeled)
  @Column({ type: 'timestamp', nullable: true })
  estimatedDeliveryAt: Date;

  // Null until an admin runs a payout covering this order — see DeliveryPartnersService.payout()
  @ManyToOne(() => Payout, { nullable: true })
  payout: Payout | null;

  // Refund tracking. Automatically flagged "pending" when a paid order gets cancelled — actually
  // issuing the refund through Razorpay's API is stubbed until real payment keys are live (see
  // OrdersService.completeRefund for the exact TODO).
  @Column({ type: 'enum', enum: RefundStatus, default: RefundStatus.NONE })
  refundStatus: RefundStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  refundAmount: number | null;

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn()
  placedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  acceptedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  readyAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  pickedUpAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  deliveredAt: Date;

  // Transient — NOT a @Column, so TypeORM's schema sync ignores these entirely. Populated
  // on demand by OrdersService.findAllForRider() via a raw ST_X/ST_Y extraction from the
  // real PostGIS location columns, for the rider app's "Navigate" deep-link into Maps.
  // Declared here (rather than just spreading into a plain object in the service) so the
  // response stays a real Order instance and ClassSerializerInterceptor keeps correctly
  // enforcing every @Exclude() on nested relations (customer.user.passwordHash etc.).
  pickupCoords?: { lat: number; lng: number } | null;
  dropCoords?: { lat: number; lng: number } | null;
}
