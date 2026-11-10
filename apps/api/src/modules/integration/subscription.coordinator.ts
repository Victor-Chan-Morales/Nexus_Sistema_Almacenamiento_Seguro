import {
  Injectable,
  Logger,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { FilesService } from '../files/files.service';
import { Subscription, SubscriptionStatus } from '../billing/entities/subscription.entity';
import { PaymentInput, resolveSimulatedPayment } from '../billing/simulated-payment';
import { OrganizationRepository } from '../iam/ports/repositories';
import { AccountNotices } from '../iam/services/account-notices.service';

/**
 * SubscriptionCoordinator — Coordinador de Integración entre Billing y Files
 *
 * Responsabilidades:
 * 1. Coordina la activación y cambio de suscripciones (POST /subscriptions/activate).
 * 2. Validación de downgrade: consulta el uso confirmado (todas las versiones retenidas y
 *    papelera dentro de los 30 días) más las reservas de carga activas en FilesModule.
 * 3. Falla segura (fail-safe): si Files falla o no responde, aborta la transacción inmediatamente;
 *    nunca asume 0 bytes.
 * 4. Control de concurrencia y carreras: ejecuta bajo transacción TypeORM con bloqueo pesimista
 *    (SELECT FOR UPDATE) e idempotencia para activaciones del mismo plan.
 * 5. Pago simulado (SPEC-305): después de la cuota y antes de persistir, resuelve la tarjeta de
 *    prueba con resolveSimulatedPayment. Un rechazo (402), una tarjeta que no es de prueba (422) o
 *    datos inválidos (400) revierten la transacción sin cambiar la suscripción. Los planes de US$0 y la
 *    reactivación idempotente no exigen tarjeta. Nunca se registra el número ni el CVV.
 * 6. Delega la persistencia en BillingService.persistSubscription para unificar la creación
 *    de suscripción, control de colisión única (23505) y registro de operaciones (con cardLast4).
 *
 * Códigos de error según CONTRACTS.md: la cuota insuficiente responde 422 STORAGE_QUOTA_EXCEEDED
 * (regla de negocio); 409 queda reservado para el conflicto de estado por activación concurrente.
 */
@Injectable()
export class SubscriptionCoordinator {
  private readonly logger = new Logger(SubscriptionCoordinator.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly filesService: FilesService,
    private readonly dataSource: DataSource,
    private readonly organizations: OrganizationRepository,
    private readonly notices: AccountNotices,
  ) {}

  /**
   * Coordina la activación o cambio de suscripción bajo una transacción atómica protegida.
   */
  async activateSubscription(
    organizationId: string,
    planId: string,
    payment?: PaymentInput,
  ): Promise<Subscription> {
    const targetPlan = await this.billingService.findPlanById(planId);

    const { subscription, changed } = await this.dataSource.transaction(async (manager: EntityManager) => {
      // Serializa incluso sin suscripción previa, sin bloquear las referencias que crean las cargas.
      await this.organizations.lockById(manager, organizationId, { allowReferences: true });
      // 1. Lectura de estado vigente con bloqueo pesimista para prevenir carreras concurrentes
      // Sin cargar el plan: PostgreSQL rechaza FOR UPDATE sobre el lado nulo de un LEFT JOIN,
      // y aquí solo hacen falta planId y el estado para cancelar la suscripción vigente.
      const currentActive = await manager.findOne(Subscription, {
        where: { organizationId, status: SubscriptionStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        loadEagerRelations: false,
      });

      // 2. Idempotencia: Si ya está activo el mismo plan, retornar la suscripción vigente sin recrear
      if (currentActive && currentActive.planId === targetPlan.id) {
        return { subscription: currentActive, changed: false };
      }

      // 3. Validación de Downgrade contra FilesModule (Uso Confirmado + Reservas Activas)
      let storageUsage: { usedBytes: bigint; reservedBytes: bigint; totalBytes: bigint };
      try {
        storageUsage = await this.filesService.getTotalStorageUsage(organizationId, manager);
        if (!storageUsage || typeof storageUsage.totalBytes !== 'bigint') {
          throw new Error('Respuesta no válida del módulo Files');
        }
      } catch (filesError: any) {
        this.logger.error(
          `Falla de seguridad: no se pudo obtener el uso de almacenamiento para la organización ${organizationId}: ${filesError?.message}`,
          filesError?.stack,
        );
        // Falla segura: abortar de inmediato la transacción. NUNCA asumir 0 bytes.
        throw new InternalServerErrorException({
          code: 'FILES_SERVICE_UNAVAILABLE',
          message: 'No fue posible validar el uso de almacenamiento con el módulo Files. Operación abortada por seguridad.',
        });
      }

      const targetStorageLimit = BigInt(targetPlan.storageLimitBytes);

      // Si el espacio ocupado + reservas supera la capacidad del nuevo plan, rechazar con 422 (cuota)
      if (storageUsage.totalBytes > targetStorageLimit) {
        throw new UnprocessableEntityException({
          code: 'STORAGE_QUOTA_EXCEEDED',
          message: `El almacenamiento actual (${storageUsage.totalBytes} bytes: ${storageUsage.usedBytes} confirmados + ${storageUsage.reservedBytes} reservados) supera la capacidad del plan seleccionado (${targetStorageLimit} bytes). Elimine o descargue archivos antes de cambiar a un plan menor.`,
        });
      }

      // 4. Pago simulado (SPEC-305): solo tras validar la cuota. Lanza 400 / 422 / 402 sin persistir nada.
      const cardLast4 = resolveSimulatedPayment(targetPlan, payment, new Date());

      // 5. Delegar la persistencia atómica en BillingService.persistSubscription
      const subscription = await this.billingService.persistSubscription(organizationId, targetPlan, manager, cardLast4);
      return { subscription, changed: true };
    });
    if (changed) await this.notices.planChanged(organizationId);
    return subscription;
  }
}
