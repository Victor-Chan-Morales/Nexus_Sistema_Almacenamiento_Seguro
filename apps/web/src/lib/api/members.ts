import { apiRequest } from "./client";
import type {
  AddMemberInput,
  AddMemberResponse,
  ApiRequestOptions,
  OrganizationMember,
  OrganizationMembersResponse,
  UpdateMemberInput,
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

/** SPEC-109 / SPEC-108: Modifica rol o estado de un miembro (PATCH /organizations/members/:id). */
export function updateMember(
  id: string,
  input: UpdateMemberInput,
  accessToken?: string,
  options?: ApiRequestOptions,
) {
  return apiRequest<OrganizationMember>(
    `/organizations/members/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    },
    { ...options, accessToken },
  );
}

/** SPEC-109 / SPEC-108: Elimina un colaborador de la organización (DELETE /organizations/members/:id). */
export function removeMember(
  id: string,
  accessToken?: string,
  options?: ApiRequestOptions,
) {
  return apiRequest<void>(
    `/organizations/members/${id}`,
    {
      method: "DELETE",
    },
    { ...options, accessToken },
  );
}
