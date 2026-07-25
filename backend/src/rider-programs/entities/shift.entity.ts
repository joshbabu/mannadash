import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Admin-defined shift slots (e.g. "Lunch", 12pm-4pm, ₹125-185/hour). Riders browse these
// and book the ones they intend to work — see ShiftBooking for the join. Deliberately no
// enforcement tying a booking to actual delivery activity (no clock-in/out) — this is a
// scheduling/intent signal for ops, matching what the reference screenshot shows, not a
// payroll system.
@Entity('shifts')
export class Shift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Short grouping label shown as a section header — "Lunch", "Snacks", "Late Night"
  @Column()
  label: string;

  @Column({ type: 'timestamptz' })
  startAt: Date;

  @Column({ type: 'timestamptz' })
  endAt: Date;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  minPayPerHour: number;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  maxPayPerHour: number;

  // Admin can retire a shift without deleting history (existing bookings stay intact)
  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
