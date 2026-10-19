import {
  Injectable,
  Logger,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { FilesService } from '../files/files.service';
import { Subscription, SubscriptionStatus } from '../billing/entities/subscription.entity';

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
 * 5. Manejo del índice único parcial: captura el error 23505 (uq_active_org_subscription)
 *    y emite un error 409 controlado de conflicto.
 */
@Injectable()
export class SubscriptionCoordinator {
  private readonly logger = new Logger(SubscriptionCoordinator.name);

  constructor(
    private readonly billingService: BillingService,
    private readonly filesService: FilesService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Coordina la activación o cambio de suscripción bajo una transacción atómica protegida.
   */
  async activateSubscription(organizationId: string, planId: string): Promise<Subscription> {
    const targetPlan = await this.billingService.findPlanById(planId);

    return this.dataSource.transaction(async (manager: EntityManager) => {
      // 1. Lectura de estado vigente con bloqueo pesimista para prevenir carreras concurrentes
      const currentActive = await manager.findOne(Subscription, {
        where: { organizationId, status: SubscriptionStatus.ACTIVE },
        lock: { mode: 'pessimistic_write' },
        relations: ['plan'],
      });

      // 2. Idempotencia: Si ya está activo el mismo plan, retornar la suscripción vigente sin recrear
      if (currentActive && currentActive.planId === targetPlan.id) {
        return currentActive;
      }

      // 3. Validación de Downgrade contra FilesModule (Uso Confirmado + Reservas Activas)
      let storageUsage: { usedBytes: bigint; reservedBytes: bigint; totalBytes: bigint };
      try {
        storageUsage = await this.filesService.getTotalStorageUsage(organizationId);
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

      // Si el espacio ocupado + reservas supera la capacidad del nuevo plan, rechazar con 409 Conflict
      if (storageUsage.totalBytes > targetStorageLimit) {
        throw new ConflictException({
          code: 'STORAGE_QUOTA_EXCEEDED',
          message: `El almacenamiento actual (${storageUsage.totalBytes} bytes: ${storageUsage.usedBytes} confirmados + ${storageUsage.reservedBytes} reservados) supera la capacidad del plan seleccionado (${targetStorageLimit} bytes). Elimine o descargue archivos antes de cambiar a un plan menor.`,
        });
      }

      // 4. Persistencia atómica de la nueva suscripción
      try {
        // Cancelar suscripción activa previa
        if (currentActive) {
          currentActive.status = SubscriptionStatus.CANCELLED;
          await manager.save(currentActive);
        }

        const startDate = new Date();
        const expiresAt = (targetPlan.validityDays && targetPlan.validityDays > 0)
          ? new Date(startDate.getTime() + targetPlan.validityDays * 86400000)
          : null;

        const newSubscription = manager.create(Subscription, {
          organizationId,
          planId: targetPlan.id,
          status: SubscriptionStatus.ACTIVE,
          simulated: true, // Sin procesamiento de cobro real
          expiresAt,
        });

        const saved = await manager.save(newSubscription);
        saved.plan = targetPlan;
        return saved;
      } catch (dbError: any) {
        // Manejo específico de colisión con el índice único parcial de PostgreSQL
        if (
          dbError?.code === '23505' ||
          dbError?.driverError?.code === '23505' ||
          dbError?.message?.includes('uq_active_org_subscription')
        ) {
          throw new ConflictException({
            code: 'CONCURRENT_SUBSCRIPTION_CONFLICT',
            message: 'Ya existe una suscripción activa para esta organización o hay una operación concurrente en curso.',
          });
        }
        throw dbError;
      }
    });
  }
}
