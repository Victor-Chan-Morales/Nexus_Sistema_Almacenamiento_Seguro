import { IsNotEmpty, IsUUID } from 'class-validator';

export class ActivateSubscriptionDto {
  @IsNotEmpty({ message: 'El planId es obligatorio' })
  @IsUUID('4', { message: 'El planId debe ser un UUID válido (v4)' })
  planId!: string;
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
}

export interface BillingOperationListResponse {
  items: BillingOperationItemResponse[];
}
