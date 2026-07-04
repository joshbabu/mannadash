import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { Exclude } from 'class-transformer';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  phone: string;

  @Column({ unique: true, nullable: true })
  email: string;

  // Excluded from all API responses via ClassSerializerInterceptor (enabled globally in main.ts) —
  // this ensures the hash never leaks even when User is nested inside another response (e.g. Order.customer.user)
  @Exclude()
  @Column()
  passwordHash: string;

  @CreateDateColumn()
  createdAt: Date;
}
