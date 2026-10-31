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
