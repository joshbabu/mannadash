import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Restaurant } from '../../restaurants/entities/restaurant.entity';

export enum OfferDiscountType {
  PERCENTAGE = 'percentage',
  FLAT = 'flat',
  FREE_DELIVERY = 'free_delivery',
}

export enum OfferAudience {
  ALL = 'all',
  FIRST_ORDER = 'first_order', // only customers who've never completed an order at this restaurant
}

/**
 * A restaurant's discount definition. Two very different UX modes share one entity:
 *  - code IS NULL → automatic. Silently evaluated at checkout; the best eligible automatic
 *    offer applies itself, no customer action needed.
 *  - code IS SET → the customer must type it. A valid code always takes precedence over
 *    whatever would have applied automatically, since typing a code is a deliberate action.
 * Every eligibility rule below is re-checked server-side at order time — nothing here is
 * ever trusted from the client, same principle as variant pricing in Phase J.
 */
@Entity('offers')
export class Offer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  restaurant: Restaurant;

  // Internal label shown on the dashboard — "Weekday Lunch 20% Off" — never shown to customers
  @Column()
  name: string;

  // Null = automatic (no code needed). Set = customer must type this exact code.
  // Uppercased and trimmed on save so "hungry20" and "HUNGRY20" are the same code.
  @Column({ type: 'varchar', nullable: true })
  code: string | null;

  @Column({ type: 'varchar' })
  discountType: OfferDiscountType;

  // Percentage (0–100) or flat rupee amount. Unused/ignored for free_delivery.
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  discountValue: number | null;

  // Caps a percentage discount in rupees — "20% off, up to ₹100". Null = uncapped.
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  maxDiscountAmount: number | null;

  // Cart subtotal must be at least this to qualify. Null = no minimum.
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  minOrderValue: number | null;

  @Column({ type: 'varchar', default: OfferAudience.ALL })
  audience: OfferAudience;

  // Restaurant can pause/resume without deleting (and losing redemption history)
  @Column({ default: true })
  active: boolean;

  // Campaign window — both null means "always on" (subject to the other rules below)
  @Column({ type: 'date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', nullable: true })
  endDate: string | null;

  // Which days this runs — e.g. ['monday','tuesday'] for a weekday-only offer.
  // Null/empty = every day.
  @Column({ type: 'jsonb', nullable: true })
  daysOfWeek: string[] | null;

  // Time-of-day window in HH:mm, e.g. lunch-only 12:00–15:00. Null = all day.
  // Deliberately not overnight-aware (unlike restaurant hours) — promo windows are a
  // same-day concept in every real reference we've seen.
  @Column({ type: 'varchar', nullable: true })
  startTime: string | null;

  @Column({ type: 'varchar', nullable: true })
  endTime: string | null;

  // How many times ONE customer can use this offer. Null = unlimited (per customer).
  @Column({ type: 'int', nullable: true })
  usageLimitPerCustomer: number | null;

  // Total redemptions allowed across ALL customers. Null = unlimited. Checked by counting
  // OfferRedemption rows, never a separate counter column — one source of truth, can't drift.
  @Column({ type: 'int', nullable: true })
  totalUsageLimit: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
