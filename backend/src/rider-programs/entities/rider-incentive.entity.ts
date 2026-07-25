import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Admin-defined incentive campaigns — "deliver 20 orders this week, earn ₹200". Progress
// is never stored here; it's always computed live from real delivered orders (see
// RiderProgramsService.getMyIncentives), so it can never drift from what actually happened.
@Entity('rider_incentives')
export class RiderIncentive {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'int' })
  targetOrders: number;

  @Column({ type: 'decimal', precision: 8, scale: 2 })
  bonusAmount: number;

  @Column({ type: 'timestamptz' })
  validFrom: Date;

  @Column({ type: 'timestamptz' })
  validTo: Date;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
