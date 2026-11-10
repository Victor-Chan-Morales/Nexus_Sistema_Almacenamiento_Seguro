import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * Simulated test-card payment (SPEC-305). Never logged, persisted or echoed:
 * only the last 4 digits of an approved test card are stored.
 */
export class PaymentDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.replace(/\s+/g, '') : value,
  )
  @IsString({ message: 'El número de tarjeta es obligatorio' })
  @MaxLength(32, { message: 'El número de tarjeta es demasiado largo' })
  cardNumber!: string;

  @IsString({ message: 'El nombre del titular es obligatorio' })
  @Length(1, 100, { message: 'El nombre del titular debe tener entre 1 y 100 caracteres' })
  holderName!: string;

  @Matches(/^(0[1-9]|1[0-2])\/\d{2}$/, { message: 'El vencimiento debe tener el formato MM/AA' })
  expiry!: string;

  @Matches(/^\d{3}$/, { message: 'El CVV debe tener 3 dígitos' })
  cvv!: string;
}

export class ActivateSubscriptionDto {
  @IsNotEmpty({ message: 'El planId es obligatorio' })
  @IsUUID('4', { message: 'El planId debe ser un UUID válido (v4)' })
  planId!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentDto)
  payment?: PaymentDto;
}

export class RenewSubscriptionDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentDto)
  payment?: PaymentDto;
}

export interface PlanItemResponse {
  id: string;
  name: string;
  description: string;
  priceMonthly: number;
  storageLimitBytes: number;
  userLimit: number;
  validityDays: number | null;
}

export interface PlanCatalogResponse {
  items: PlanItemResponse[];
}

export interface SubscriptionActivationResponse {
  subscriptionId: string;
  status: 'active';
  simulated: true;
  startDate: string;
  endDate: string | null;
}

export interface SubscriptionDetailResponse {
  id: string;
  organizationId: string;
  status: 'active' | 'expired' | 'cancelled';
  simulated: boolean;
  expiresAt: string | null;
  createdAt: string;
  plan: PlanItemResponse;
}

export interface BillingOperationItemResponse {
  id: string;
  type: 'charge' | 'renewal';
  planName: string;
  amount: number;
  simulated: true;
  occurredAt: string;
  /** Last 4 digits of the approved test card; null for US$0 charges and free-plan renewals. */
  cardLast4: string | null;
}

export interface BillingOperationListResponse {
  items: BillingOperationItemResponse[];
}
