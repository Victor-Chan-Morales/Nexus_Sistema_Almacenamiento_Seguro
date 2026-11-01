import { Role } from '../domain/enums';

/** CONTRACTS.md v0.5 · POST /organizations/members → 201. Fechas ISO-8601 UTC. */
export interface MemberDto {
  id: string; // id de la membresía
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  status: string;
  createdAt: string;
}

/** CONTRACTS.md v0.5 · GET /organizations/members. A diferencia del alta, la fecha se llama joinedAt. */
export interface MemberListItemDto {
  id: string; // id de la membresía
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  status: string;
  joinedAt: string;
}

export interface MemberListDto {
  members: MemberListItemDto[];
  totalMembers: number;
  /** Límite de usuarios del plan vigente; null si no hay suscripción vigente. */
  userLimit: number | null;
}
