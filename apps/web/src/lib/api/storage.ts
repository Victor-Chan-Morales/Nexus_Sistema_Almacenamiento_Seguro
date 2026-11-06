import { apiRequest } from "./client";
import type {
  ApiRequestOptions,
  CreateDestinationInput,
  CreateInstallationRequestInput,
  CreateInstallationRequestResponse,
  Destination,
  DestinationListResponse,
  InstallationRequestListResponse,
  StoragePolicy,
  TestDestinationResponse,
  UpdateStoragePolicyInput,
  UUID,
} from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** SPEC-804: política de almacenamiento de la organización (GET /organizations/storage-policy; cualquier miembro). */
export function getStoragePolicy(accessToken?: string, options?: ApiRequestOptions) {
  return apiRequest<StoragePolicy>(
    "/organizations/storage-policy",
    { method: "GET" },
    { ...options, accessToken },
  );
}

/** SPEC-804: cambia el modelo y el destino predeterminado (PUT /organizations/storage-policy; solo tenant_admin). */
export function updateStoragePolicy(input: UpdateStoragePolicyInput, accessToken?: string, options?: ApiRequestOptions) {
  return apiRequest<StoragePolicy>(
    "/organizations/storage-policy",
    { method: "PUT", body: JSON.stringify(input), headers: JSON_HEADERS },
    { ...options, accessToken },
  );
}

/** SPEC-804: destinos de la organización con su estado de conexión (GET /destinations; solo tenant_admin). */
export function listDestinations(accessToken?: string, options?: ApiRequestOptions) {
  return apiRequest<DestinationListResponse>(
    "/destinations",
    { method: "GET" },
    { ...options, accessToken },
  );
}

/** SPEC-804: registra un destino nuevo, que nace con estado "Sin comprobar" (POST /destinations; solo tenant_admin). */
export function createDestination(input: CreateDestinationInput, accessToken?: string, options?: ApiRequestOptions) {
  return apiRequest<Destination>(
    "/destinations",
    { method: "POST", body: JSON.stringify(input), headers: JSON_HEADERS },
    { ...options, accessToken },
  );
}

/** SPEC-804: prueba la conexión de un destino (POST /destinations/:id/test; solo tenant_admin). */
export function testDestination(destinationId: UUID, accessToken?: string, options?: ApiRequestOptions) {
  return apiRequest<TestDestinationResponse>(
    `/destinations/${encodeURIComponent(destinationId)}/test`,
    { method: "POST" },
    { ...options, accessToken },
  );
}

/** SPEC-804: solicitudes de instalación de la organización, de la más reciente a la más antigua (GET /organizations/installation-requests; solo tenant_admin). */
export function listInstallationRequests(accessToken?: string, options?: ApiRequestOptions) {
  return apiRequest<InstallationRequestListResponse>(
    "/organizations/installation-requests",
    { method: "GET" },
    { ...options, accessToken },
  );
}

/** SPEC-804: solicita la instalación de un modelo (POST /organizations/installation-requests; solo tenant_admin). */
export function createInstallationRequest(input: CreateInstallationRequestInput, accessToken?: string, options?: ApiRequestOptions) {
  return apiRequest<CreateInstallationRequestResponse>(
    "/organizations/installation-requests",
    { method: "POST", body: JSON.stringify(input), headers: JSON_HEADERS },
    { ...options, accessToken },
  );
}
