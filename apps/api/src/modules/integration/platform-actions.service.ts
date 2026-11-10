import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditAction, AuditEventInput, AuditResource } from '../audit/audit.types';
import { AuditService } from '../audit/audit.service';
import { DeploymentModel, OrgStatus } from '../iam/domain/enums';
import { Organization } from '../iam/entities/organization.entity';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { OrganizationRepository } from '../iam/ports/repositories';
import { SessionService } from '../iam/services/session.service';
import { Installation, InstallationStatus } from './entities/installation.entity';
import { InstallationRequest, InstallationRequestStatus } from './entities/installation-request.entity';

/** Elemento de la lista de solicitudes del Super Admin (SPEC-503 §4, escenario 4). Sin correos ni nombres de archivo. */
export interface InstallationRequestAdminItem {
  id: string;
  organizationId: string;
  organizationName: string;
  requestedModel: DeploymentModel;
  status: InstallationRequestStatus;
  createdAt: string;
  reviewedAt: string | null;
}

/**
 * Máquina de estados de admin.installation (SPEC-503 §8 y decisión D5).
 * Solo Pendiente -> En proceso, En proceso -> Operativa y En proceso -> Fallida son válidas.
 * Cualquier otro par (incluido Pendiente -> Fallida y el mismo estado) responde 422.
 */
export const INSTALLATION_TRANSITIONS: Readonly<Record<InstallationStatus, readonly InstallationStatus[]>> = {
  'No solicitada': [],
  Pendiente: ['En proceso'],
  'En proceso': ['Operativa', 'Fallida'],
  Operativa: [],
  Fallida: [],
};

/**
 * PlatformActionsService — SPEC-503: acciones del Super Admin sobre organizaciones, solicitudes e instalaciones.
 *
 * Todas las escrituras van en una transacción con bloqueo de fila (SELECT ... FOR UPDATE) para evitar dobles
 * revisiones. La auditoría se escribe después del commit y es best-effort (D8): un fallo no revierte el cambio.
 * La protección por rol (SuperAdminGuard) la aplica el controlador; este servicio no comprueba permisos.
 */
@Injectable()
export class PlatformActionsService {
  private readonly logger = new Logger(PlatformActionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly organizations: OrganizationRepository,
    private readonly sessions: SessionService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /** Suspende una organización activa y revoca las sesiones de sus miembros en la misma transacción. */
  async suspendOrganization(
    actor: AuthUser,
    organizationId: string,
  ): Promise<{ id: string; status: 'suspended' }> {
    // D2: la comprobación de propia organización va antes de validar el estado.
    if (organizationId === actor.organizationId) throw cannotSuspendOwnOrganizationError();

    await this.dataSource.transaction(async (tx) => {
      const org = await this.organizations.findByIdForUpdate(organizationId, tx);
      if (!org) throw organizationNotFoundError();
      if (org.status !== OrgStatus.ACTIVE) throw invalidOrganizationTransitionError();

      await this.organizations.setStatus(tx, organizationId, OrgStatus.SUSPENDED);
      await this.sessions.revokeAllOfOrganization(tx, organizationId);
    });

    this.recordAudit({
      organizationId,
      actorId: actor.userId,
      action: AuditAction.ORGANIZATION_SUSPENDED,
      resourceType: AuditResource.ORGANIZATION,
      resourceId: organizationId,
    });

    return { id: organizationId, status: 'suspended' };
  }

  /** Reactiva una organización suspendida o cancelada. */
  async reactivateOrganization(
    actor: AuthUser,
    organizationId: string,
  ): Promise<{ id: string; status: 'active' }> {
    await this.dataSource.transaction(async (tx) => {
      const org = await this.organizations.findByIdForUpdate(organizationId, tx);
      if (!org) throw organizationNotFoundError();
      if (org.status !== OrgStatus.SUSPENDED && org.status !== OrgStatus.CANCELLED) {
        throw invalidOrganizationTransitionError();
      }

      await this.organizations.setStatus(tx, organizationId, OrgStatus.ACTIVE);
    });

    this.recordAudit({
      organizationId,
      actorId: actor.userId,
      action: AuditAction.ORGANIZATION_REACTIVATED,
      resourceType: AuditResource.ORGANIZATION,
      resourceId: organizationId,
    });

    return { id: organizationId, status: 'active' };
  }

  /** Solicitudes de instalación de todas las organizaciones, de la más antigua a la más reciente (D3, D4). */
  async listInstallationRequests(
    status?: InstallationRequestStatus,
  ): Promise<{ items: InstallationRequestAdminItem[] }> {
    const rows = await this.dataSource.manager.find(InstallationRequest, {
      select: {
        requestId: true,
        organizationId: true,
        requestedModel: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
      },
      where: status ? { status } : {},
      order: { createdAt: 'ASC' },
    });
    if (rows.length === 0) return { items: [] };

    // Consulta aparte a admin.organization solo para el nombre; no se traen columnas de usuario.
    const organizationIds = [...new Set(rows.map((row) => row.organizationId))];
    const orgs = await this.dataSource.manager.find(Organization, {
      select: { id: true, name: true },
      where: { id: In(organizationIds) },
    });
    const names = new Map(orgs.map((org) => [org.id, org.name]));

    return {
      items: rows.map((row) => ({
        id: row.requestId,
        organizationId: row.organizationId,
        organizationName: names.get(row.organizationId) ?? '',
        requestedModel: row.requestedModel,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      })),
    };
  }

  /**
   * Aprueba una solicitud Pendiente: queda Aprobada con reviewedAt y se crea la instalación en Pendiente.
   * No comprueba el estado de la organización (D7): aprobar también funciona si está suspendida o cancelada.
   */
  async approveInstallationRequest(
    actor: AuthUser,
    requestId: string,
    dto: { operatorName: string; hostReference?: string | null },
  ): Promise<{ requestId: string; installationId: string }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const request = await lockPendingRequest(manager, requestId);
      const now = new Date();

      await manager.update(InstallationRequest, { requestId }, { status: 'Aprobada', reviewedAt: now });
      const installation = await manager.save(
        manager.create(Installation, {
          organizationId: request.organizationId,
          requestId,
          deploymentModel: request.requestedModel,
          status: 'Pendiente',
          operatorName: dto.operatorName,
          hostReference: dto.hostReference ?? null,
          installedVersion: null,
          updatedAt: null,
        }),
      );

      return { organizationId: request.organizationId, installationId: installation.installationId };
    });

    this.recordAudit({
      organizationId: result.organizationId,
      actorId: actor.userId,
      action: AuditAction.INSTALLATION_REQUEST_APPROVED,
      resourceType: AuditResource.INSTALLATION_REQUEST,
      resourceId: requestId,
    });

    return { requestId, installationId: result.installationId };
  }

  /** Rechaza una solicitud Pendiente. No crea instalación. */
  async rejectInstallationRequest(
    actor: AuthUser,
    requestId: string,
  ): Promise<{ requestId: string; status: 'Rechazada' }> {
    const organizationId = await this.dataSource.transaction(async (manager) => {
      const request = await lockPendingRequest(manager, requestId);
      await manager.update(
        InstallationRequest,
        { requestId },
        { status: 'Rechazada', reviewedAt: new Date() },
      );
      return request.organizationId;
    });

    this.recordAudit({
      organizationId,
      actorId: actor.userId,
      action: AuditAction.INSTALLATION_REQUEST_REJECTED,
      resourceType: AuditResource.INSTALLATION_REQUEST,
      resourceId: requestId,
    });

    return { requestId, status: 'Rechazada' };
  }

  /** Avanza el estado de una instalación según INSTALLATION_TRANSITIONS (D5). */
  async updateInstallationStatus(
    actor: AuthUser,
    installationId: string,
    status: InstallationStatus,
  ): Promise<{ id: string; status: InstallationStatus }> {
    const organizationId = await this.dataSource.transaction(async (manager) => {
      const installation = await manager.findOne(Installation, {
        where: { installationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!installation) throw installationNotFoundError();
      if (!INSTALLATION_TRANSITIONS[installation.status].includes(status)) {
        throw invalidInstallationTransitionError();
      }

      await manager.update(Installation, { installationId }, { status, updatedAt: new Date() });
      return installation.organizationId;
    });

    this.recordAudit({
      organizationId,
      actorId: actor.userId,
      action: AuditAction.INSTALLATION_STATUS_CHANGED,
      resourceType: AuditResource.INSTALLATION,
      resourceId: installationId,
    });

    return { id: installationId, status };
  }

  /**
   * Auditoría posterior al commit (D8). Un fallo, sincrónico o asíncrono, solo se registra en el log:
   * no revierte el cambio ni llega al cliente.
   */
  private recordAudit(input: AuditEventInput): void {
    const logFailure = (err: unknown): void => {
      this.logger.warn(
        `No se pudo registrar ${input.action} para ${input.organizationId}: ${
          err instanceof Error ? err.message : 'error desconocido'
        }`,
      );
    };
    try {
      void this.auditService?.logEvent(input).catch(logFailure);
    } catch (err) {
      logFailure(err);
    }
  }
}

/** Bloquea la solicitud (SELECT ... FOR UPDATE) y exige que esté Pendiente. */
async function lockPendingRequest(manager: EntityManager, requestId: string): Promise<InstallationRequest> {
  const request = await manager.findOne(InstallationRequest, {
    where: { requestId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!request) throw installationRequestNotFoundError();
  if (request.status !== 'Pendiente') throw requestAlreadyReviewedError();
  return request;
}

function organizationNotFoundError(): NotFoundException {
  return new NotFoundException({
    code: 'ORGANIZATION_NOT_FOUND',
    message: 'Organización no encontrada',
  });
}

function cannotSuspendOwnOrganizationError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'CANNOT_SUSPEND_OWN_ORGANIZATION',
    message: 'No se puede suspender la organización interna del Super Admin',
  });
}

function invalidOrganizationTransitionError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INVALID_ORGANIZATION_TRANSITION',
    message: 'La transición de estado de la organización no está permitida',
  });
}

function installationRequestNotFoundError(): NotFoundException {
  return new NotFoundException({
    code: 'INSTALLATION_REQUEST_NOT_FOUND',
    message: 'Solicitud de instalación no encontrada',
  });
}

function requestAlreadyReviewedError(): ConflictException {
  return new ConflictException({
    code: 'REQUEST_ALREADY_REVIEWED',
    message: 'La solicitud de instalación ya fue revisada',
  });
}

function installationNotFoundError(): NotFoundException {
  return new NotFoundException({
    code: 'INSTALLATION_NOT_FOUND',
    message: 'Instalación no encontrada',
  });
}

function invalidInstallationTransitionError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INVALID_INSTALLATION_TRANSITION',
    message: 'La transición de estado de la instalación no está permitida',
  });
}
