import { Injectable, OnModuleInit } from '@nestjs/common';
import { MemberAdmission } from '../../iam/member-admission';
import { BillingService } from '../billing.service';

/**
 * Fuente del límite de usuarios que exige el alta de miembros de IAM (SPEC-102). Devuelve
 * `plan.maxMembers` de la suscripción vigente, o null si no hay suscripción vigente (IAM lo trata
 * como límite 0 y responde USER_LIMIT_EXCEEDED). Es solo lectura: no bloquea filas, porque IAM ya
 * tiene bloqueada la organización mientras la consulta.
 */
@Injectable()
export class UserLimitHook implements OnModuleInit {
  constructor(
    private readonly admission: MemberAdmission,
    private readonly billing: BillingService,
  ) {}

  onModuleInit(): void {
    this.admission.register(async (organizationId) => {
      const subscription = await this.billing.getSubscription(organizationId);
      return subscription?.plan?.maxMembers ?? null;
    });
  }
}
