import { Column, Entity, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Order } from './order.entity';
import { MenuItem } from '../../menu-items/entities/menu-item.entity';
import { OrderItemOption } from './order-item-option.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  order: Order;

  @ManyToOne(() => MenuItem)
  menuItem: MenuItem;

  @Column({ type: 'int' })
  quantity: number;

  // Snapshot of price at order time, so later menu price changes don't affect past orders
  @Column({ type: 'decimal', precision: 8, scale: 2 })
  priceAtOrder: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  // "Size: Large", "Spice: Extra hot" — see order-item-option.entity.ts for why these are
  // snapshotted rather than a live join
  @OneToMany(() => OrderItemOption, (opt) => opt.orderItem, { cascade: true })
  selectedOptions: OrderItemOption[];
}
