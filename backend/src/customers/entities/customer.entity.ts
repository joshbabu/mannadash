import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column({ nullable: true })
  defaultAddress: string;

  // Array of saved locations: [{ label, address, lat, lng }]
  @Column({ type: 'jsonb', default: [] })
  savedLocations: Record<string, any>[];

  // Favorited restaurant IDs — simple list, not per-dish. Restaurant-level favorites are
  // what most customers actually mean by "favorites" (a place they order from again),
  // and keeps this simple rather than a second favorites concept for individual dishes.
  @Column({ type: 'jsonb', default: [] })
  favoriteRestaurantIds: string[];

  @CreateDateColumn()
  createdAt: Date;
}
