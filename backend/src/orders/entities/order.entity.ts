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
}
