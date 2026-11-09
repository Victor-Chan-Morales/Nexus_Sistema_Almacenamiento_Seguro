import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DeploymentModel } from '../../iam/domain/enums';

/** ENUM admin.request_status. */
export type InstallationRequestStatus = 'Pendiente' | 'Aprobada' | 'Rechazada' | 'Cerrada';

/**
 * Tabla admin.installation_request (creada en database/migrations/20260928090200_create_tables_admin.sql).
 * Coordinada con SPEC-503: esta entidad solo registra la solicitud del Tenant Admin; la revisión del
 * Super Admin (cambio de estado, operador asignado) pertenece a SPEC-503 y no se implementa aquí.
 * No hay migración en SPEC-803. created_at y request_id los genera la BD.
 */
@Entity({ schema: 'admin', name: 'installation_request' })
export class InstallationRequest {
  @PrimaryGeneratedColumn('uuid', { name: 'request_id' })
  requestId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** Columna ENUM admin.deployment_model: se mapea como texto y los valores vienen de DeploymentModel. */
  @Column({ name: 'requested_model', type: 'varchar' })
  requestedModel!: DeploymentModel;

  @Column({ name: 'status', type: 'varchar' })
  status!: InstallationRequestStatus;

  @Column({ name: 'requested_by', type: 'uuid' })
  requestedBy!: string;

  @Column({ name: 'assigned_operator', type: 'varchar', length: 150, nullable: true })
  assignedOperator!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;
}
