import { Injectable, Optional } from '@nestjs/common';
import { MembershipStatus } from './domain/enums';
import { MembershipRepository } from './ports/repositories';

/** SPEC-220: miembro activo de una organización, con lo mínimo que otros módulos necesitan mostrar. */
export interface ActiveMember {
  userId: string;
  fullName: string;
  email: string;
}

/**
 * Devuelve el límite de usuarios del plan vigente de la organización, o null si no hay plan vigente.
 * La fuente se consulta ANTES de abrir la transacción del alta: usa otra conexión del pool, y leerla dentro
 * de la transacción podía agotar el pool. No debe bloquear filas de la organización.
 */
export type UserLimitSource = (organizationId: string) => Promise<number | null>;

/**
 * Política de límite de miembros sin acoplar IAM a Billing (mismo idioma que RegistrationHooks):
 * Billing registra la fuente en onModuleInit (billing/registration/user-limit.hook.ts).
 * Sin fuente registrada o sin plan, `userLimit` devuelve null y MembersService lo trata como 0
 * (falla cerrada: USER_LIMIT_EXCEEDED).
 */
@Injectable()
export class MemberAdmission {
  private source?: UserLimitSource;

  constructor(@Optional() private readonly memberships?: MembershipRepository) {}

  register(source: UserLimitSource): void {
    this.source = source; // registrar dos veces reemplaza (idempotente)
  }

  async userLimit(organizationId: string): Promise<number | null> {
    return this.source ? this.source(organizationId) : null;
  }

  /**
   * SPEC-220: miembros con membresía activa en la organización. Sin repositorio devuelve [] (falla cerrada).
   * Nunca expone el hash de contraseña: el repositorio solo carga nombre, correo y estado.
   */
  async activeMembers(organizationId: string): Promise<ActiveMember[]> {
    if (!this.memberships) return [];
    const rows = await this.memberships.listByOrganization(organizationId);
    return rows
      .filter((membership) => membership.status === MembershipStatus.ACTIVE)
      .map((membership) => ({
        userId: membership.userId,
        fullName: membership.user.fullName,
        email: membership.user.email,
      }));
  }

  /** SPEC-220: ¿tiene esta persona una membresía activa en la organización? Falla cerrada sin repositorio. */
  async isActiveMember(organizationId: string, userId: string): Promise<boolean> {
    return (await this.activeMembers(organizationId)).some((member) => member.userId === userId);
  }
}
