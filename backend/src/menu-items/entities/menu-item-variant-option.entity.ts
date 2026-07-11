import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { MenuItemVariantGroup } from './menu-item-variant-group.entity';

/**
 * One selectable choice within a variant group — "Large" within the "Size" group, priced
 * as a delta on top of the dish's base price (can be 0, e.g. "Small" often adds nothing).
 */
@Entity('menu_item_variant_options')
export class MenuItemVariantOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => MenuItemVariantGroup, (group) => group.options, { onDelete: 'CASCADE' })
  group: MenuItemVariantGroup;

  @Column()
  label: string;

  @Column({ type: 'decimal', precision: 8, scale: 2, default: 0 })
  priceDelta: number;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;
}
