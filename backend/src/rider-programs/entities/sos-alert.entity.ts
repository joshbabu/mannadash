import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DeliveryPartner } from '../../delivery-partners/entities/delivery-partner.entity';

// Logged server-side so ops actually has visibility (see RiderProgramsController's admin
// GET /sos-alerts) — an SOS button that only does something client-side (dial 100, share a
// map link) with no record anywhere isn't really a safety feature, it's a shortcut.
@Entity('sos_alerts')
export class SosAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DeliveryPartner, { onDelete: 'CASCADE' })
  deliveryPartner: DeliveryPartner;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7 })
  longitude: number;

  @CreateDateColumn()
  createdAt: Date;
}
