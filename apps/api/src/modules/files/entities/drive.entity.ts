import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('drives')
export class Drive {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @Column({ name: 'owner_user_id', nullable: true })
  ownerUserId: string;

  @Column({ default: 'Mi espacio' })
  name: string;

  @Column({ default: 'personal' })
  type: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}