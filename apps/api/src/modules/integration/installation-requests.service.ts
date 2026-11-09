import { ConflictException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { OrganizationRepository } from '../iam/ports/repositories';
import {
  CreateInstallationRequestDto,
  InstallationRequestCreatedDto,
  InstallationRequestItemDto,
  InstallationRequestListDto,
} from './dto/installation-request.dto';
import { InstallationRequest } from './entities/installation-request.entity';
import { organizationNotFoundError } from './storage-policy.errors';

export interface InstallationRequestActor {
  organizationId: string;
  userId: string;
}

/**
 * SPEC-803 escenario 11 (SRP): registra y lista las solicitudes de instalación de una organización.
 * Solo registra el pedido de ayuda para instalar: no es requisito para elegir el modelo (SPEC-803 §12).
 * La revisión del Super Admin pertenece a SPEC-503.
 */
@Injectable()
export class InstallationRequestsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly organizations: OrganizationRepository,
    @InjectRepository(InstallationRequest)
    private readonly requests: Repository<InstallationRequest>,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /** Crea una solicitud en `Pendiente`. Si ya hay una pendiente de la organización, responde 409. */
  async create(
    actor: InstallationRequestActor,
    dto: CreateInstallationRequestDto,
  ): Promise<InstallationRequestCreatedDto> {
    const saved = await this.dataSource.transaction(async (manager) => {
      // El bloqueo de la organización serializa dos solicitudes simultáneas: la segunda ve la primera pendiente.
      const exists = await this.organizations.lockById(manager, actor.organizationId);
      if (!exists) throw organizationNotFoundError();

      const pending = await manager.exists(InstallationRequest, {
        where: { organizationId: actor.organizationId, status: 'Pendiente' },
      });
      if (pending) throw pendingRequestError();

      return manager.save(
        manager.create(InstallationRequest, {
          organizationId: actor.organizationId,
          requestedModel: dto.requestedModel,
          status: 'Pendiente',
          requestedBy: actor.userId,
          assignedOperator: null,
          reviewedAt: null,
        }),
      );
    });

    void this.auditService?.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: AuditAction.INSTALLATION_REQUESTED,
      resourceType: AuditResource.INSTALLATION_REQUEST,
      resourceId: saved.requestId,
    });

    return { id: saved.requestId, status: saved.status, createdAt: saved.createdAt.toISOString() };
  }

  /** Solicitudes de la organización de la sesión, de la más reciente a la más antigua. */
  async list(actor: InstallationRequestActor): Promise<InstallationRequestListDto> {
    const rows = await this.requests.find({
      where: { organizationId: actor.organizationId },
      order: { createdAt: 'DESC' },
    });
    return { items: rows.map((row) => toItem(row)) };
  }
}

function toItem(row: InstallationRequest): InstallationRequestItemDto {
  return {
    id: row.requestId,
    requestedModel: row.requestedModel,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  };
}

/** SPEC-803 escenario 11: 409. Ya hay una solicitud pendiente de la organización. */
function pendingRequestError(): ConflictException {
  return new ConflictException({
    code: 'INSTALLATION_REQUEST_PENDING',
    message: 'Ya tienes una solicitud de instalación pendiente',
  });
}
