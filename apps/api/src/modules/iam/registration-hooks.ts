import { Injectable } from '@nestjs/common';
import { TransactionContext } from './ports/transaction';

export interface RegistrationContext {
  /** Transacción del registro: lo que escriban los hooks se confirma o revierte junto. */
  manager: TransactionContext;
  userId: string;
  organizationId: string;
}

export type RegistrationHook = (ctx: RegistrationContext) => Promise<void>;

/**
 * Abierto a extensión, cerrado a modificación (OCP): otros módulos participan en el registro
 * sin que IAM los conozca y sin dependencias circulares (Billing y Files ya importan IamModule por el guard).
 *
 * Billing: hooks.register('demo-subscription', ({ manager, organizationId }) => ...)
 * Files:   hooks.register('personal-drive',    ({ manager, userId, organizationId }) => ...)
 */
@Injectable()
export class RegistrationHooks {
  private readonly hooks = new Map<string, RegistrationHook>();

  register(name: string, hook: RegistrationHook): void {
    this.hooks.set(name, hook); // registrar dos veces el mismo nombre reemplaza (idempotente)
  }

  async run(ctx: RegistrationContext): Promise<void> {
    for (const hook of this.hooks.values()) {
      await hook(ctx);
    }
  }
}
