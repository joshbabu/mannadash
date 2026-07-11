import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Offer } from './offer.entity';
import { Order } from '../../orders/entities/order.entity';
import { Customer } from '../../customers/entities/customer.entity';

/**
 * One redemption of one offer on one order. This is the single source of truth for usage
 * limits — Offer never carries a running counter, so there's nothing to drift out of sync.
 * "Has this customer used this offer before?" and "how many times has this offer been used
 * in total?" are both just counts against this table.
 */
@Entity('offer_redemptions')
export class OfferRedemption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Offer, { onDelete: 'CASCADE' })
  offer: Offer;

  // Unique — an order can redeem at most one offer, and once redeemed it stays redeemed
  // even if the order later gets cancelled (matches how the discount already left an
  // honest trail on the order's own discountAmount field for receipts/history).
  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  order: Order;

  @ManyToOne(() => Customer, { onDelete: 'CASCADE' })
  customer: Customer;

  // Snapshot of what was actually discounted — survives the offer being edited or
  // deleted later, same principle as priceAtOrder and OrderItemOption.
  @Column({ type: 'decimal', precision: 8, scale: 2 })
  discountAmount: number;

  @CreateDateColumn()
  redeemedAt: Date;
}
