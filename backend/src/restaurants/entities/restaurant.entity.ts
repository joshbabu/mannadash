import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Exclude } from 'class-transformer';
import { MenuItem } from '../../menu-items/entities/menu-item.entity';

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

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 20.0 })
  commissionRate: number;

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
