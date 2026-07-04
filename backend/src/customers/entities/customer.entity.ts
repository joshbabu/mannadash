import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column({ nullable: true })
  defaultAddress: string;

  // Array of saved locations: [{ label, address, lat, lng }]
  @Column({ type: 'jsonb', default: [] })
  savedLocations: Record<string, any>[];

  @CreateDateColumn()
  createdAt: Date;
}
