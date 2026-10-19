import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Tabla iam.role (catálogo de 2 filas: 1 tenant_admin, 2 colaborador). Solo lectura desde la API. */
@Entity({ schema: 'iam', name: 'role' })
export class IamRole {
  @PrimaryColumn({ name: 'role_id', type: 'smallint' })
  id!: number;

  @Column({ type: 'varchar', length: 50 })
  name!: string;
}
