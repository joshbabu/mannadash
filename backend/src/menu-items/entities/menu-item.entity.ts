import { Column, CreateDateColumn, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Restaurant } from '../../restaurants/entities/restaurant.entity';
import { MenuItemVariantGroup } from './menu-item-variant-group.entity';

export enum MenuCategory {
  BREAKFAST = 'breakfast',
  STARTER = 'starter',
  LUNCH = 'lunch',
  DINNER = 'dinner',
  MAIN = 'main',
  DESSERT = 'dessert',
  BEVERAGE = 'beverage',
}

@Entity('menu_items')
export class MenuItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Restaurant, (restaurant) => restaurant.menuItems, { onDelete: 'CASCADE' })
  restaurant: Restaurant;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  price: number;

  // Optional "was" price to show a discount (e.g. ₹299 struck through, ₹199 highlighted).
  // Purely for display — the actual amount charged always comes from `price` above.
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  originalPrice: number | null;

  @Column({ type: 'enum', enum: MenuCategory, default: MenuCategory.MAIN })
  category: MenuCategory;

  @Column({ default: true })
  isVeg: boolean;

  @Column({ default: true })
  isAvailable: boolean;

  // Cloudflare R2 URL
  @Column({ nullable: true })
  imageUrl: string;

  @CreateDateColumn()
  createdAt: Date;

  // Size, Spice Level, Add-ons, etc. — see menu-item-variant-group.entity.ts
  @OneToMany(() => MenuItemVariantGroup, (group) => group.menuItem, { cascade: true })
  variantGroups: MenuItemVariantGroup[];
}
