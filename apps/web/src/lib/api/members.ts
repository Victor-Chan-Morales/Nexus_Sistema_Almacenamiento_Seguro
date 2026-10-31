import { apiRequest } from "./client";
import type {
  AddMemberInput,
  AddMemberResponse,
  ApiRequestOptions,
  OrganizationMembersResponse,
} from "./types";

/** SPEC-106: Obtiene los miembros de la organización (GET /organizations/members). */
export function getMembers(accessToken?: string, options?: ApiRequestOptions) {
  return apiRequest<OrganizationMembersResponse>(
    "/organizations/members",
    { method: "GET" },
    { ...options, accessToken },
  );
}

/** SPEC-106: Registra un nuevo miembro en el tenant y envía invitación (POST /organizations/members). */
export function addMember(input: AddMemberInput, accessToken?: string, options?: ApiRequestOptions) {
  return apiRequest<AddMemberResponse>(
    "/organizations/members",
    {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    },
    { ...options, accessToken },
  );
}