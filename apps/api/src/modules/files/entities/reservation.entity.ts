import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity({ schema: "files", name: "reservation" })
export class Reservation {
  @PrimaryGeneratedColumn("uuid", { name: "reservation_id" })
  id!: string;

  @Column({ name: "organization_id", type: "uuid" })
  organizationId!: string;

  @Column({ name: "size_bytes", type: "bigint" })
  sizeBytes!: string;

  @Column({
    type: "enum",
    enum: ["active", "released", "expired"],
    enumName: "reservation_status",
    default: "active",
  })
  status!: "active" | "released" | "expired";

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
