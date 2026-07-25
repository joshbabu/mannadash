import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Exclude } from 'class-transformer';
import { MenuItem } from '../../menu-items/entities/menu-item.entity';
import { WeeklyHours } from '../operating-hours.util';

export enum RestaurantStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  SUSPENDED = 'suspended',
}

@Entity('restaurants')
export class Restaurant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  ownerName: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column()
  cuisineType: string;

  @Column()
  address: string;

  // PostGIS geography point — used for "restaurants near me" via ST_DWithin
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
  })
  location: string;

  @Column()
  phone: string;

  @Column({ default: true })
  isOpen: boolean;

  // Simple daily hours (same schedule every day) — HH:MM 24-hour format. Null means "always open"
  // whenever isOpen is true, keeping backward compatibility with restaurants that never set these.
  @Column({ type: 'varchar', length: 5, nullable: true })
  openTime: string | null;

  @Column({ type: 'varchar', length: 5, nullable: true })
  closeTime: string | null;

  // === Onboarding wizard fields (all optional — pre-wizard restaurants have them null) ===

  // Owner contact — for payment updates, complaints, order issues (mirrors Swiggy's owner block)
  @Column({ type: 'varchar', nullable: true })
  ownerEmail: string | null;

  @Column({ type: 'varchar', nullable: true })
  whatsappNumber: string | null;

  // Per-day hours: { monday: { open: 'HH:MM', close: 'HH:MM' } | null, ... }. Null day = closed.
  // When set, takes precedence over the single openTime/closeTime window above — see
  // isWithinRestaurantHours in operating-hours.util.ts.
  @Column({ type: 'jsonb', nullable: true })
  weeklyHours: WeeklyHours | null;

  // KYC documents, reviewed by the admin before approval. FSSAI is a legal requirement for
  // food businesses in India and is displayed publicly by convention; GSTIN is public record.
  @Column({ type: 'varchar', nullable: true })
  fssaiNumber: string | null;

  @Column({ type: 'date', nullable: true })
  fssaiExpiry: string | null;

  @Column({ type: 'varchar', nullable: true })
  gstin: string | null;

  // Optional — a restaurant's registered legal entity name can differ from its public
  // display `name` (e.g. "MEHFIL RESTAURANT" vs "Mehfil"). Purely restaurant-controlled;
  // null just means they haven't entered one, shown honestly as "not on file" on the tax
  // invoice rather than falling back to `name`, which is a marketing name, not a legal one.
  @Column({ type: 'varchar', nullable: true })
  legalEntityName: string | null;

  // PAN and bank details are sensitive — excluded from every serialized API response.
  // Admins (and the owner themselves) read them via the dedicated GET /restaurants/:id/kyc.
  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  pan: string | null;

  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  bankIfsc: string | null;

  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  bankAccountNumber: string | null;

  // Menu basics captured at onboarding — the customer app renders both on restaurant cards
  @Column({ default: false })
  isVegOnly: boolean;

  @Column({ type: 'int', nullable: true })
  costForTwo: number | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 20.0 })
  commissionRate: number;

  // Null = no minimum. Restaurant-configurable via Settings, enforced at order placement
  // (checkout also warns the customer before they try).
  @Column({ type: 'int', nullable: true })
  minOrderValue: number | null;

  // Null/0 = no packaging fee. Restaurant-configurable via Settings — packaging cost
  // genuinely varies by restaurant (a biryani place needs different containers than a
  // bakery), unlike platform fee/GST which are platform-wide env-gated decisions. Always
  // clamped to PACKAGING_FEE_CAP at order-computation time (orders.service.ts) as a
  // second line of defense — a restaurant setting a value above the cap gets clamped down,
  // not rejected outright, so a cap lowered later doesn't strand an existing setting in an
  // invalid state.
  @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
  packagingFee: number | null;

  @Column({ default: 30 })
  avgPrepTimeMins: number;

  @Column({ type: 'enum', enum: RestaurantStatus, default: RestaurantStatus.PENDING })
  status: RestaurantStatus;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  ratingAvg: number;

  @Column({ type: 'int', default: 0 })
  ratingCount: number;

  // Null until the owner claims this restaurant via /restaurants/signup — see RestaurantsService.signup
  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  passwordHash: string | null;

  @OneToMany(() => MenuItem, (item) => item.restaurant)
  menuItems: MenuItem[];

  @CreateDateColumn()
  createdAt: Date;
}
