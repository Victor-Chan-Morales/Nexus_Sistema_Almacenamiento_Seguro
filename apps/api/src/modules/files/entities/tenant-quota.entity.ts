import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ schema: "files", name: "tenant_quota" })
export class TenantQuota {
  @PrimaryColumn({ name: "organization_id", type: "uuid" })
  organizationId!: string;

  @Column({ name: "confirmed_usage_bytes", type: "bigint", default: 0 })
  confirmedUsageBytes!: string;

  @Column({ name: "active_reservations_bytes", type: "bigint", default: 0 })
  activeReservationsBytes!: string;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
