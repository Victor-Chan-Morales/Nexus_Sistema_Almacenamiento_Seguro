import { apiRequest } from "./client";
import type { ActivateSubscriptionResponse, ApiRequestOptions, PlanCatalogResponse, UUID } from "./types";

export function getPlans(options?: ApiRequestOptions) {
  return apiRequest<PlanCatalogResponse>("/plans", { method: "GET" }, options);
}

export function activateSubscription(planId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<ActivateSubscriptionResponse>("/subscriptions/activate", {
    method: "POST",
    body: JSON.stringify({ planId }),
    headers: { "Content-Type": "application/json" },
  }, { ...options, accessToken });
}
