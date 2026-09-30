
export class ActivateSubscriptionDto {
  planId!: string;
}

export interface PlanResponse {
  id: string;
  name: string;
  description: string;
  priceMonthly: number;
  storageLimitBytes: number;
  userLimit: number;
  validityDays: number;
}

export interface SubscriptionActivationResponse {
  subscriptionId: string;
  status: string;
  simulated: boolean;
  startDate: string;
  endDate: string;
}