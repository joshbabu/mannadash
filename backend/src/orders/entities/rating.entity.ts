import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Order } from './order.entity';

@Entity('ratings')
export class Rating {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order)
  order: Order;

  @Column({ type: 'smallint' })
  restaurantRating: number;

  @Column({ type: 'smallint' })
  deliveryRating: number;

  @Column({ type: 'text', nullable: true })
  comment: string;

  // A restaurant's public reply to this review — L3 of the partner dashboard suite.
  // Nullable: most reviews will never get a reply, and that's fine.
  @Column({ type: 'text', nullable: true })
  replyText: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  repliedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
