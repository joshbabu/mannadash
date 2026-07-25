import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

// Broadcast to every rider — not targeted, no read-tracking (that'd need a per-rider
// read-receipt table, deliberately left out for now; see rider-programs.controller.ts).
@Entity('announcements')
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
