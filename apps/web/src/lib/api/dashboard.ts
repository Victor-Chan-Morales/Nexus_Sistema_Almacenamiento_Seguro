import { apiRequest } from "./client";
import type { ApiRequestOptions, DashboardResponse } from "./types";

export function getDashboard(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<DashboardResponse>("/dashboard", { method: "GET" }, { ...options, accessToken });
}
