import { apiRequest } from "./client";
import type {
  AddTeamMemberInput,
  ApiRequestOptions,
  ChangeTeamMemberLevelInput,
  CreateTeamInput,
  CreatedTeam,
  TeamMembersResponse,
  TeamsResponse,
  UUID,
} from "./types";

type TeamRequestOptions = Omit<ApiRequestOptions, "accessToken">;

/** SPEC-220: equipos visibles para el solicitante. `tenant_admin` ve todos; un colaborador, solo los suyos. */
export function listTeams(accessToken: string, options?: TeamRequestOptions) {
  return apiRequest<TeamsResponse>("/teams", { method: "GET" }, { ...options, accessToken });
}

/** SPEC-220: crea el equipo con su Drive y su carpeta raíz. Solo `tenant_admin`. */
export function createTeam(input: CreateTeamInput, accessToken: string, options?: TeamRequestOptions) {
  return apiRequest<CreatedTeam>("/teams", {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
  }, { ...options, accessToken });
}

/** SPEC-220: miembros activos del equipo con su nivel. Solo `tenant_admin`. */
export function listTeamMembers(teamId: UUID, accessToken: string, options?: TeamRequestOptions) {
  return apiRequest<TeamMembersResponse>(`/teams/${encodeURIComponent(teamId)}/members`, { method: "GET" }, { ...options, accessToken });
}

/** SPEC-220: agrega un miembro con nivel. Responde 201 sin cuerpo. */
export function addTeamMember(teamId: UUID, input: AddTeamMemberInput, accessToken: string, options?: TeamRequestOptions) {
  return apiRequest<void>(`/teams/${encodeURIComponent(teamId)}/members`, {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
  }, { ...options, accessToken });
}

/** SPEC-220: cambia el nivel de un miembro. Responde 200 sin cuerpo. */
export function changeTeamMemberLevel(teamId: UUID, userId: UUID, input: ChangeTeamMemberLevelInput, accessToken: string, options?: TeamRequestOptions) {
  return apiRequest<void>(`/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
  }, { ...options, accessToken });
}

/** SPEC-220: quita a un miembro del equipo. Responde 204. */
export function removeTeamMember(teamId: UUID, userId: UUID, accessToken: string, options?: TeamRequestOptions) {
  return apiRequest<void>(`/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  }, { ...options, accessToken });
}
