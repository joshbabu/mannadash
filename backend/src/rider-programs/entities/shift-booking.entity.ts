import { CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Shift } from './shift.entity';
import { DeliveryPartner } from '../../delivery-partners/entities/delivery-partner.entity';

// One rider can only book a given shift once — the unique index below is what actually
// enforces that at the database level, not just an application-side check (see
// RiderProgramsService.bookShift for why the check-then-insert alone wasn't enough).
@Entity('shift_bookings')
@Index(['shift', 'deliveryPartner'], { unique: true })
export class ShiftBooking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Shift, { onDelete: 'CASCADE' })
  shift: Shift;

  @ManyToOne(() => DeliveryPartner, { onDelete: 'CASCADE' })
  deliveryPartner: DeliveryPartner;

  @CreateDateColumn()
  bookedAt: Date;
}
