import { Injectable } from '@nestjs/common';

/**
 * Devuelve el límite de usuarios del plan vigente de la organización, o null si no hay plan vigente.
 * La fuente NO debe bloquear la fila de la organización: el alta de miembros ya la tiene bloqueada
 * mientras la consulta (otra conexión) y esperaría indefinidamente.
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

  register(source: UserLimitSource): void {
    this.source = source; // registrar dos veces reemplaza (idempotente)
  }

  async userLimit(organizationId: string): Promise<number | null> {
    return this.source ? this.source(organizationId) : null;
  }
}
