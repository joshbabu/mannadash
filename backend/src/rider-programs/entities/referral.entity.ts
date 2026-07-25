import { CreateDateColumn, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DeliveryPartner } from '../../delivery-partners/entities/delivery-partner.entity';

// A rider can only be referred once — enforced at the DB level, same reasoning as
// ShiftBooking's unique index. Created at signup time when a valid referralCode is
// supplied (see DeliveryPartnersService.signup); an invalid/typo'd code just means no
// Referral row gets created, it doesn't block the signup itself.
@Entity('referrals')
@Index(['referee'], { unique: true })
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => DeliveryPartner, { onDelete: 'CASCADE' })
  referrer: DeliveryPartner;

  @ManyToOne(() => DeliveryPartner, { onDelete: 'CASCADE' })
  referee: DeliveryPartner;

  @CreateDateColumn()
  createdAt: Date;
}
