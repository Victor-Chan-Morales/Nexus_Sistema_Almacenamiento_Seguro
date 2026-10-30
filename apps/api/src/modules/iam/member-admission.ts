import { Injectable } from '@nestjs/common';

export type UserLimitSource = (organizationId: string) => Promise<number | null>;

/**
 * MemberAdmission — Punto de extensión desacoplado (DIP / OCP) para admisiones en IAM.
 *
 * Permite a otros dominios (como Billing) registrar la fuente que dictamina el cupo máximo
 * de miembros activos por organización (plan.maxMembers), sin que IAM conozca ni dependa de Billing.
 *
 * Principio de Falla Cerrada (Fail-Closed):
 * Si no hay fuente registrada o la organización carece de plan vigente, userLimit devuelve 0
 * provocando el rechazo controlado 422 USER_LIMIT_EXCEEDED al intentar agregar miembros.
 */
@Injectable()
export class MemberAdmission {
  private source: UserLimitSource | null = null;

  register(source: UserLimitSource): void {
    this.source = source;
  }

  async userLimit(organizationId: string): Promise<number> {
    if (!this.source) {
      return 0;
    }
    const limit = await this.source(organizationId);
    if (limit === null || limit === undefined || limit < 0) {
      return 0;
    }
    return limit;
  }
}
