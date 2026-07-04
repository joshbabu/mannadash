import { Column, CreateDateColumn, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Customer } from '../../customers/entities/customer.entity';
import { Restaurant } from '../../restaurants/entities/restaurant.entity';
import { DeliveryPartner } from '../../delivery-partners/entities/delivery-partner.entity';
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

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
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

  // Set when create-payment is called, before the customer actually pays
  @Column({ nullable: true })
  razorpayOrderId: string;

  // Razorpay payment reference — set only after successful payment verification
  @Column({ nullable: true })
  paymentId: string;

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
