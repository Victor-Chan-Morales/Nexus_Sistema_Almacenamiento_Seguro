import { IsEnum, ValidateIf } from 'class-validator';
import { MembershipStatus, Role } from '../domain/enums';

/**
 * Cuerpo de PATCH /organizations/members/:id: `role`, `status` o ambos (al menos uno). No acepta organizationId ni
 * ningún otro campo (forbidNonWhitelisted). Cada campo se valida si viene, o si falta el otro: así `{}` falla.
 */
export class UpdateMemberDto {
  @ValidateIf((o: UpdateMemberDto) => o.role !== undefined || o.status === undefined)
  @IsEnum(Role, { message: 'Indique role (tenant_admin o colaborador), status o ambos' })
  role?: Role;

  @ValidateIf((o: UpdateMemberDto) => o.status !== undefined || o.role === undefined)
  @IsEnum(MembershipStatus, { message: 'status debe ser active o suspended' })
  status?: MembershipStatus;
}
