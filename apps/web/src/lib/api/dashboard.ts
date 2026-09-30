import { apiRequest, ApiRequestOptions } from "./client";

/** `plan` and `recentActivity` need fuller schemas from the domain owners. */
export type DashboardResponse = {
  organizationName: string;
  plan: unknown;
  storageUsedBytes: number;
  storageLimitBytes: number;
  recentActivity: unknown[];
};

export function getDashboard(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<DashboardResponse>("/dashboard", { method: "GET" }, { ...options, accessToken });
}
