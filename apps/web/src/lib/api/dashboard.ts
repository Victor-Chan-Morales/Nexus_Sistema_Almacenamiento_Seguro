import { apiRequest } from "./client";
import type { ApiRequestOptions, DashboardResponse } from "./types";

export function getDashboard<TPlan = unknown, TActivity = unknown>(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<DashboardResponse<TPlan, TActivity>>("/dashboard", { method: "GET" }, { ...options, accessToken });
}
