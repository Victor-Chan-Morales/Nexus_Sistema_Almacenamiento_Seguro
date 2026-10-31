import { Injectable, OnModuleInit } from '@nestjs/common';
import { MemberAdmission } from '../../iam/member-admission';
import { BillingService } from '../billing.service';

/**
 * Hook `user-limit` (SPEC-102 T6)
 *
 * Registra en el puerto MemberAdmission de IAM la fuente de verdad del límite de usuarios,
 * derivado de la suscripción activa de la organización (`plan.maxMembers`).
 *
 * Principio de Falla Cerrada (Fail-Closed):
 * Si la organización no tiene suscripción vigente, expiró o no cuenta con plan asociado,
 * retorna 0, haciendo que cualquier intento de admisión de miembros sea rechazado con
 * 422 USER_LIMIT_EXCEEDED.
 */
@Injectable()
export class UserLimitHook implements OnModuleInit {
  constructor(
    private readonly memberAdmission: MemberAdmission,
    private readonly billingService: BillingService,
  ) {}

  onModuleInit(): void {
    this.memberAdmission.register(async (organizationId: string) => {
      const subscription = await this.billingService.getSubscription(organizationId);
      if (!subscription || !subscription.plan) {
        return 0;
      }
      return subscription.plan.maxMembers;
    });
  }
}
