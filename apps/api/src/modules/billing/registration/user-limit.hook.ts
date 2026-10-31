import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { BillingService } from '../billing.service';

export type UserLimitSource = (organizationId: string) => Promise<number | null>;

/**
 * Puerto de admisión de miembros desacoplado (DIP / OCP) para resolver el límite de usuarios de IAM (SPEC-102).
 * Falla cerrada: si no hay fuente registrada o la organización no tiene suscripción activa, userLimit devuelve 0.
 */
@Injectable()
export class MemberAdmission {
  private source: UserLimitSource | null = null;

  register(source: UserLimitSource): void {
    this.source = source;
  }

  async userLimit(organizationId: string): Promise<number> {
    if (!this.source) {
      return 0; // Falla cerrada: sin fuente registrada
    }
    const limit = await this.source(organizationId);
    if (limit === null || limit === undefined || limit < 0) {
      return 0; // Falla cerrada: sin plan vigente o valor inválido
    }
    return limit;
  }
}

/**
 * Hook `user-limit` (SPEC-102 T6)
 *
 * Registra en el puerto MemberAdmission la fuente de verdad del límite de usuarios,
 * derivado de la suscripción activa de la organización (`plan.maxMembers`).
 *
 * Principio de Falla Cerrada (Fail-Closed):
 * Si la organización no tiene suscripción vigente o carece de plan asociado,
 * devuelve 0, provocando el rechazo controlado 422 USER_LIMIT_EXCEEDED al intentar agregar miembros.
 */
@Injectable()
export class UserLimitHook implements OnModuleInit {
  constructor(
    @Optional() private readonly admission: MemberAdmission,
    private readonly billingService: BillingService,
  ) {}

  onModuleInit(): void {
    if (!this.admission) {
      return;
    }
    this.admission.register(async (organizationId: string) => {
      const subscription = await this.billingService.getSubscription(organizationId);
      if (!subscription || !subscription.plan) {
        return 0;
      }
      return subscription.plan.maxMembers;
    });
  }
}
