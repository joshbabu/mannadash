import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('push_subscriptions')
export class PushSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The rider's (or later, restaurant's) own ID — not a foreign key relation, since this needs
  // to work generically across roles without pulling in every entity type
  @Column()
  subscriberId: string;

  @Column()
  subscriberRole: string; // 'rider' | 'restaurant'

  // The browser's PushSubscription object (endpoint + keys), stored as-is
  @Column({ type: 'jsonb' })
  subscription: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
