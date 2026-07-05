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

  @CreateDateColumn()
  createdAt: Date;
}
