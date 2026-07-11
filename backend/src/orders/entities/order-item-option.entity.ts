import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { OrderItem } from './order-item.entity';
import { MenuItemVariantOption } from '../../menu-items/entities/menu-item-variant-option.entity';

/**
 * One selected variant on an order line — "Size: Large" — snapshotted at order time,
 * same reasoning as OrderItem.priceAtOrder: the restaurant may later rename, reprice, or
 * delete the variant option, but the customer's receipt and the kitchen's ticket must keep
 * showing exactly what was ordered. The FK is kept (nullable, SET NULL on delete) purely
 * for reporting/analytics convenience — display always uses the snapshot fields, never a
 * live join through the FK.
 */
@Entity('order_item_options')
export class OrderItemOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => OrderItem, (item) => item.selectedOptions, { onDelete: 'CASCADE' })
  orderItem: OrderItem;

  @ManyToOne(() => MenuItemVariantOption, { nullable: true, onDelete: 'SET NULL' })
  variantOption: MenuItemVariantOption | null;

  @Column()
  groupName: string;

  @Column()
  optionLabel: string;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  priceDeltaAtOrder: number;
}
