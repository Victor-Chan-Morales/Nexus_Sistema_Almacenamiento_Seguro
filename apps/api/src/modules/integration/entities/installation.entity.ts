import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DeploymentModel } from '../../iam/domain/enums';

/** ENUM admin.installation_status (valores en español, según el enum existente). */
export type InstallationStatus = 'No solicitada' | 'Pendiente' | 'En proceso' | 'Operativa' | 'Fallida';

/**
 * Tabla admin.installation (creada en database/migrations/20260928090200_create_tables_admin.sql).
 * Coordinada con SPEC-503: esta entidad solo mapea la tabla. La lógica de transición de estado
 * (Pendiente -> En proceso -> Operativa o Fallida) vive en PlatformActionsService (SPEC-503), no aquí.
 * No hay migración en SPEC-503. installation_id y created_at los genera la BD; updated_at no tiene
 * default en BD y lo fija el servicio al cambiar el estado.
 */
@Entity({ schema: 'admin', name: 'installation' })
export class Installation {
  @PrimaryGeneratedColumn('uuid', { name: 'installation_id' })
  installationId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  /** Columna ENUM admin.deployment_model: se mapea como texto y los valores vienen de DeploymentModel. */
  @Column({ name: 'deployment_model', type: 'varchar' })
  deploymentModel!: DeploymentModel;

  /** Columna ENUM admin.installation_status: se mapea como texto y los valores vienen de InstallationStatus. */
  @Column({ name: 'status', type: 'varchar' })
  status!: InstallationStatus;

  @Column({ name: 'installed_version', type: 'varchar', length: 50, nullable: true })
  installedVersion!: string | null;

  @Column({ name: 'host_reference', type: 'varchar', length: 255, nullable: true })
  hostReference!: string | null;

  @Column({ name: 'operator_name', type: 'varchar', length: 150 })
  operatorName!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Sin default en BD: lo escribe PlatformActionsService al cambiar el estado. */
  @Column({ name: 'updated_at', type: 'timestamptz', nullable: true })
  updatedAt!: Date | null;
}
