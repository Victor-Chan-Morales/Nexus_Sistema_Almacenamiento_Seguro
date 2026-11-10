import { apiRequest } from "./client";
import type { ActivateSubscriptionResponse, ApiRequestOptions, BillingOperationsResponse, BillingReceipt, PaymentCardPayload, PlanCatalogResponse, RenewSubscriptionResponse, UUID } from "./types";

export function getPlans(options?: ApiRequestOptions) {
  return apiRequest<PlanCatalogResponse>("/plans", { method: "GET" }, options);
}

export function activateSubscription(planId: UUID, accessToken: string, payment?: PaymentCardPayload, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<ActivateSubscriptionResponse>("/subscriptions/activate", {
    method: "POST",
    body: JSON.stringify(payment ? { planId, payment } : { planId }),
    headers: { "Content-Type": "application/json" },
  }, { ...options, accessToken });
}

export function getBillingOperations(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<BillingOperationsResponse>("/billing/operations", { method: "GET" }, { ...options, accessToken });
}

// SPEC-306: comprobante imprimible de una operación de la organización de la sesión.
export function getBillingReceipt(operationId: UUID, accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<BillingReceipt>(`/billing/operations/${encodeURIComponent(operationId)}/receipt`, { method: "GET" }, { ...options, accessToken });
}

export function renewSubscription(accessToken: string, payment?: PaymentCardPayload, options?: Omit<ApiRequestOptions, "accessToken">) {
  const init: RequestInit = payment
    ? { method: "POST", body: JSON.stringify({ payment }), headers: { "Content-Type": "application/json" } }
    : { method: "POST" };
  return apiRequest<RenewSubscriptionResponse>("/subscriptions/renew", init, { ...options, accessToken });
}
