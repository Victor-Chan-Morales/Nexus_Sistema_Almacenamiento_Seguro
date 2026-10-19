import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Tabla admin.organization. created_at / updated_at los llena la BD (default y trigger). */
@Entity({ schema: 'admin', name: 'organization' })
export class Organization {
  @PrimaryGeneratedColumn('uuid', { name: 'organization_id' })
  id!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  /** ENUM admin.organization_status (active | suspended | cancelled). */
  @Column({ type: 'varchar' })
  status!: string;

  /** ENUM admin.deployment_model, NOT NULL y sin default: el registro debe enviarlo. */
  @Column({ name: 'deployment_model', type: 'varchar' })
  deploymentModel!: string;
}
