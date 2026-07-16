import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Order } from './order.entity';

export type ComplaintCategory = 'wrong_item' | 'missing_item' | 'quality_issue' | 'late_delivery' | 'other';
export type ComplaintStatus = 'open' | 'in_progress' | 'resolved';

@Entity('complaints')
export class Complaint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order)
  order: Order;

  @Column({ type: 'varchar' })
  category: ComplaintCategory;

  @Column({ type: 'text' })
  description: string;

  // Unlike Rating (one per order), a customer can file multiple complaints against the
  // same order over time — a missing item and a quality issue are genuinely different
  // things worth tracking separately, not one review that gets edited.
  @Column({ type: 'varchar', default: 'open' })
  status: ComplaintStatus;

  // Restaurant's response — same "one reply, updated in place" pattern as Rating.replyText,
  // not a full back-and-forth thread. Admin can also update status without necessarily
  // writing a response of their own (e.g. marking something resolved after a call).
  @Column({ type: 'text', nullable: true })
  restaurantResponse: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
