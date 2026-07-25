import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Exclude } from 'class-transformer';

export enum VehicleType {
  BIKE = 'bike',
  SCOOTER = 'scooter',
  BICYCLE = 'bicycle',
}

@Entity('delivery_partners')
export class DeliveryPartner {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  phone: string;

  @Exclude()
  @Column()
  passwordHash: string;

  @Column({ type: 'enum', enum: VehicleType, default: VehicleType.BIKE })
  vehicleType: VehicleType;

  // Cloudflare R2 URL
  @Column({ nullable: true })
  licenseDocUrl: string;

  // PostGIS point — updated frequently as rider moves, used for nearest-rider queries
  @Column({
    type: 'geography',
    spatialFeatureType: 'Point',
    srid: 4326,
    nullable: true,
  })
  currentLocation: string;

  @Column({ default: false })
  isAvailable: boolean;

  @Column({ default: false })
  isVerified: boolean;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  ratingAvg: number;

  @Column({ type: 'int', default: 0 })
  ratingCount: number;

  // Assigned at signup for every new rider (see DeliveryPartnersService.generateUniqueReferralCode).
  // Nullable — not because it's optional in practice, but because `synchronize: true` can't
  // add a NOT NULL column to a table that already has real rows with nothing to backfill
  // them with (this broke a production deploy once already). Existing riders get one
  // lazily generated the first time it's actually needed — see getMyReferrals(). Postgres
  // allows multiple NULLs under a unique constraint, so this is safe pre-backfill.
  @Column({ type: 'varchar', unique: true, nullable: true })
  referralCode: string | null;

  // Bank details — same @Exclude() convention as Restaurant's pan/bank fields: real data,
  // never serialized in a normal find/findOne response. Only reachable through the
  // dedicated self-service get/update endpoints in delivery-partners.controller.ts.
  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  bankIfsc: string | null;

  @Exclude()
  @Column({ type: 'varchar', nullable: true })
  bankAccountNumber: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
