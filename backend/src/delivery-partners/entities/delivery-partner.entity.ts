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

  // Assigned once at signup (see DeliveryPartnersService.generateUniqueReferralCode) — a
  // short code this rider can share; another rider entering it at their own signup creates
  // a Referral row (see rider-programs). Not sensitive, fine to expose normally.
  @Column({ unique: true })
  referralCode: string;

  // Bank details — same @Exclude() convention as Restaurant's pan/bank fields: real data,
  // never serialized in a normal find/findOne response. Only reachable through the
  // dedicated self-service get/update endpoints in delivery-partners.controller.ts.
  @Exclude()
  @Column({ nullable: true })
  bankIfsc: string | null;

  @Exclude()
  @Column({ nullable: true })
  bankAccountNumber: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
