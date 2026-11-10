import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { BillingService } from '../billing/billing.service';
import { OrgStatus } from '../iam/domain/enums';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { OrganizationRepository, UserRepository } from '../iam/ports/repositories';
import { PasswordHasher } from '../iam/ports/security';
import { UnitOfWork } from '../iam/ports/transaction';
import { AccountNotices } from '../iam/services/account-notices.service';
import { SessionService } from '../iam/services/session.service';
import { CloseOrganizationDto } from './dto/close-organization.dto';

/**
 * OrganizationClosureService — SPEC-114: Eliminar Empresa (Bloquear y Conservar)
 *
 * Módulo integrador que orquesta la baja de una organización entre IAM y Billing:
 * - Verifica la identidad del tenant_admin con contraseña antes de iniciar la transacción.
 * - En una sola transacción atómica:
 *   1. Bloquea y cambia el estado de admin.organization a 'cancelled'.
 *   2. Cancela la suscripción activa en billing.subscription.
 *   3. Revoca todas las sesiones activas en iam.session masivamente.
 * - Conserva el 100% de los archivos y metadatos en Files/Storage (estrictamente sin llamadas a FilesService).
 */
@Injectable()
export class OrganizationClosureService {
  private readonly logger = new Logger(OrganizationClosureService.name);

  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly billing: BillingService,
    private readonly sessions: SessionService,
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly uow: UnitOfWork,
    private readonly notices: AccountNotices,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async close(actor: AuthUser, dto: CloseOrganizationDto): Promise<{ closed: true }> {
    // 1. Verificación de seguridad previa: la contraseña debe validarse antes de la transacción (Argon2 es costoso)
    const user = await this.users.findById(actor.userId);
    if (!user || !(await this.hasher.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Contraseña incorrecta',
      });
    }

    // 2. Transacción atómica de cierre
    const recipients = await this.uow.run(async (tx) => {
      const org = await this.organizations.findByIdForUpdate(actor.organizationId, tx);
      if (!org) {
        throw new NotFoundException({
          code: 'ORGANIZATION_NOT_FOUND',
          message: 'Organización no encontrada',
        });
      }

      if (org.name.trim() !== dto.organizationName.trim()) {
        throw new UnprocessableEntityException({
          code: 'ORGANIZATION_NAME_MISMATCH',
          message: 'El nombre de la organización no coincide',
        });
      }

      const recipients = org.status === OrgStatus.ACTIVE
        ? await this.notices.captureClosureRecipients(tx, org.id)
        : [];

      // Paso A: UPDATE admin.organization SET status = 'cancelled'
      await this.organizations.setStatus(tx, org.id, OrgStatus.CANCELLED);

      // Paso B: UPDATE billing.subscription SET status = 'cancelled', end_date = CURRENT_DATE
      await this.billing.cancelActive(org.id, tx);

      // Paso C: UPDATE iam.session SET revoked_at = NOW() masivo
      await this.sessions.revokeAllOfOrganization(tx, org.id);
      return recipients;
    });

    await this.notices.organizationClosed(recipients);

    // 3. Auditoría posterior al commit (best-effort, SPEC-114 §8): un fallo no revierte el cierre, pero se registra.
    void this.audit?.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: AuditAction.ORGANIZATION_CLOSED,
      resourceType: AuditResource.ORGANIZATION,
      resourceId: actor.organizationId,
    }).catch((err: unknown) => {
      this.logger.warn(
        `No se pudo registrar ORGANIZATION_CLOSED para ${actor.organizationId}: ${
          err instanceof Error ? err.message : 'error desconocido'
        }`,
      );
    });

    return { closed: true };
  }
}
