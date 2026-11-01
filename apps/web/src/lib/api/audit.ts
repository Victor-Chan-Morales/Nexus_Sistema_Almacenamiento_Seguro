import { apiRequest } from "./client";
import type { ApiRequestOptions, AuditEventsQuery, AuditEventsResponse } from "./types";

/** SPEC-403: bitácora de la organización (GET /audit/events, solo tenant_admin). */
export function getAuditEvents(accessToken: string, { limit, before }: AuditEventsQuery = {}, options?: Omit<ApiRequestOptions, "accessToken">) {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (before) params.set("before", before);
  const query = params.toString();
  return apiRequest<AuditEventsResponse>(`/audit/events${query ? `?${query}` : ""}`, { method: "GET" }, { ...options, accessToken });
}
