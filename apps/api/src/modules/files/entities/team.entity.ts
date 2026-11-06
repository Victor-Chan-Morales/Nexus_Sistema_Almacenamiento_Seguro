import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** SPEC-220: equipo de una organización. Crear un equipo crea también su Drive de tipo `team`. */
@Entity({ schema: 'files', name: 'team' })
export class Team {
  @PrimaryGeneratedColumn('uuid', { name: 'team_id' })
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
