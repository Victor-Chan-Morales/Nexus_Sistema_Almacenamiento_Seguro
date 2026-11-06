import { apiRequest } from "./client";
import type {
  ApiRequestOptions,
  CloseOrganizationInput,
  CloseOrganizationResponse,
} from "./types";

/** SPEC-114: Cierra la organización, cancela suscripción y revoca sesiones (POST /organizations/close). */
export function closeOrganization(
  input: CloseOrganizationInput,
  accessToken?: string,
  options?: ApiRequestOptions,
) {
  return apiRequest<CloseOrganizationResponse>(
    "/organizations/close",
    {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    },
    { ...options, accessToken },
  );
}
