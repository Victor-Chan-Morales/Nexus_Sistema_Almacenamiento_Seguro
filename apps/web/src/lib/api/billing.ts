import { apiRequest, ApiRequestOptions } from "./client";

export type Plan = {
  id: string;
  name: string;
  description: string;
  priceMonthly: number;
  storageLimitBytes: number;
  userLimit: number;
  validityDays: number;
};

export type PlanCatalogResponse = { items: Plan[] };

export type ActivateSubscriptionResponse = {
  subscriptionId: string;
  status: "active";
  simulated: true;
  startDate: string;
  endDate: string | null;
};

export function getPlans(options?: ApiRequestOptions) {
  return apiRequest<PlanCatalogResponse>("/plans", { method: "GET" }, options);
}

export function activateSubscription(planId: string, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<ActivateSubscriptionResponse>("/subscriptions/activate", {
    method: "POST",
    body: JSON.stringify({ planId }),
    headers: { "Content-Type": "application/json" },
  }, { ...options, accessToken });
}
