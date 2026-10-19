import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from '../domain/enums';
import { Organization } from './organization.entity';
import { IamRole } from './role.entity';
import { User } from './user.entity';

/**
 * Tabla iam.membership (usuario ↔ organización, N:M, único por par).
 * El rol vive en la tabla iam.role: `roleRef` debe cargarse para leer `role`.
 */
@Entity({ schema: 'iam', name: 'membership' })
export class Membership {
  @PrimaryGeneratedColumn('uuid', { name: 'membership_id' })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'role_id', type: 'smallint' })
  roleId!: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization!: Organization;

  @ManyToOne(() => IamRole)
  @JoinColumn({ name: 'role_id' })
  roleRef!: IamRole;

  /** ENUM iam.membership_status (active | suspended). */
  @Column({ type: 'varchar' })
  status!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Nombre del rol (tenant_admin | colaborador). Requiere `roleRef` cargado. */
  get role(): Role {
    return this.roleRef?.name as Role;
  }
}
