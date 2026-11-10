import { ApiError, apiRequest } from "./client";
import type {
  ApiRequestOptions,
  ApprovePlatformInstallationInput,
  ApprovePlatformInstallationResponse,
  InstallationRequestStatus,
  PlatformInstallationRequestsResponse,
  PlatformMetrics,
  PlatformOrganizationsResponse,
  PlatformStatusChange,
  RejectPlatformInstallationResponse,
  UpdatePlatformInstallationInput,
  UpdatePlatformInstallationResponse,
  UUID,
} from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** SPEC-502: mensajes en español por código de error de la API de plataforma. */
const PLATFORM_ERROR_MESSAGES = new Map<string, string>([
  ["PLATFORM_ADMIN_REQUIRED", "Tu cuenta no tiene permiso de administración de la plataforma."],
  ["REQUEST_ALREADY_REVIEWED", "Otra persona ya revisó esta solicitud. Se actualizó la lista."],
  ["CANNOT_SUSPEND_OWN_ORGANIZATION", "No puedes suspender tu propia organización."],
  ["INVALID_ORGANIZATION_TRANSITION", "El estado de la organización cambió. Se actualizó la tabla."],
  ["INVALID_INSTALLATION_TRANSITION", "Ese cambio de estado no está permitido para la instalación."],
  ["ORGANIZATION_NOT_FOUND", "El elemento ya no existe."],
  ["INSTALLATION_REQUEST_NOT_FOUND", "El elemento ya no existe."],
  ["INSTALLATION_NOT_FOUND", "El elemento ya no existe."],
  ["VALIDATION_ERROR", "Revisa los datos enviados."],
]);

/** SPEC-502: métricas globales de la plataforma (GET /platform/metrics; solo Super Admin). */
export function getPlatformMetrics(accessToken: string, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<PlatformMetrics>("/platform/metrics", { method: "GET" }, { ...options, accessToken });
}

/** SPEC-502: organizaciones paginadas de la plataforma (GET /platform/organizations; solo Super Admin). */
export function listPlatformOrganizations(
  accessToken: string,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
  options?: Omit<ApiRequestOptions, "accessToken">,
) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return apiRequest<PlatformOrganizationsResponse>(`/platform/organizations?${params.toString()}`, { method: "GET" }, { ...options, accessToken });
}

/** SPEC-502: suspende una organización (POST /platform/organizations/:id/suspend; sin cuerpo). */
export function suspendOrganization(accessToken: string, organizationId: UUID, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<PlatformStatusChange>(
    `/platform/organizations/${encodeURIComponent(organizationId)}/suspend`,
    { method: "POST" },
    { ...options, accessToken },
  );
}

/** SPEC-502: reactiva una organización suspendida (POST /platform/organizations/:id/reactivate). */
export function reactivateOrganization(accessToken: string, organizationId: UUID, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<PlatformStatusChange>(
    `/platform/organizations/${encodeURIComponent(organizationId)}/reactivate`,
    { method: "POST" },
    { ...options, accessToken },
  );
}

/** SPEC-502: solicitudes de instalación de todas las organizaciones, con filtro de estado opcional (GET /platform/installation-requests). */
export function listPlatformInstallationRequests(
  accessToken: string,
  status?: InstallationRequestStatus,
  options?: Omit<ApiRequestOptions, "accessToken">,
) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const query = params.toString();
  return apiRequest<PlatformInstallationRequestsResponse>(
    `/platform/installation-requests${query ? `?${query}` : ""}`,
    { method: "GET" },
    { ...options, accessToken },
  );
}

/** SPEC-502: aprueba una solicitud; recorta operatorName y omite hostReference si queda vacío (POST /platform/installation-requests/:id/approve). */
export function approveInstallationRequest(
  accessToken: string,
  requestId: UUID,
  input: ApprovePlatformInstallationInput,
  options?: Omit<ApiRequestOptions, "accessToken">,
) {
  const hostReference = input.hostReference?.trim();
  const body: ApprovePlatformInstallationInput = {
    operatorName: input.operatorName.trim(),
    ...(hostReference ? { hostReference } : {}),
  };
  return apiRequest<ApprovePlatformInstallationResponse>(
    `/platform/installation-requests/${encodeURIComponent(requestId)}/approve`,
    { method: "POST", body: JSON.stringify(body), headers: JSON_HEADERS },
    { ...options, accessToken },
  );
}

/** SPEC-502: rechaza una solicitud pendiente (POST /platform/installation-requests/:id/reject). */
export function rejectInstallationRequest(accessToken: string, requestId: UUID, options?: Omit<ApiRequestOptions, "accessToken">) {
  return apiRequest<RejectPlatformInstallationResponse>(
    `/platform/installation-requests/${encodeURIComponent(requestId)}/reject`,
    { method: "POST" },
    { ...options, accessToken },
  );
}

/** SPEC-502: cambia el estado de una instalación (PATCH /platform/installations/:id). */
export function updateInstallationStatus(
  accessToken: string,
  installationId: UUID,
  input: UpdatePlatformInstallationInput,
  options?: Omit<ApiRequestOptions, "accessToken">,
) {
  return apiRequest<UpdatePlatformInstallationResponse>(
    `/platform/installations/${encodeURIComponent(installationId)}`,
    { method: "PATCH", body: JSON.stringify(input), headers: JSON_HEADERS },
    { ...options, accessToken },
  );
}

/** SPEC-502: convierte un error de la API de plataforma en un mensaje para la UI; cualquier otro caso usa `fallback`. */
export function platformErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  // Error de red: client.ts ya lo expresa en español.
  if (error.status === 0) return error.message;
  return PLATFORM_ERROR_MESSAGES.get(error.code) ?? fallback;
}
