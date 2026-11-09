import { Injectable, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { destinationNotAvailableError } from '../files/destination-errors';
import { DestinationDefaults } from '../files/destination-defaults.service';
import { OrganizationRepository } from '../iam/ports/repositories';
import { StoragePolicyDto, UpdateStoragePolicyDto } from './dto/storage-policy.dto';
import { STORAGE_MODEL_REQUIREMENTS } from './storage-model-requirements';
import {
  defaultNotCompatibleError,
  organizationNotFoundError,
  requirementsUnmetError,
} from './storage-policy.errors';

export interface StoragePolicyActor {
  organizationId: string;
  userId: string;
}

/**
 * SPEC-803 (Coordinador): cambia el modelo de despliegue de una organización y su destino predeterminado.
 * Coordina IAM (la organización) y Files (los destinos) en una sola transacción. Las versiones existentes no se
 * tocan (escenario 4): solo cambian el modelo, el predeterminado y las raíces de los Drives, dentro de DestinationDefaults.
 * La organización siempre sale de la sesión del actor, nunca del cuerpo.
 */
@Injectable()
export class StoragePolicyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly organizations: OrganizationRepository,
    private readonly destinationDefaults: DestinationDefaults,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  /** SPEC-803 escenario 1: modelo, destinos disponibles y predeterminado. Sin credenciales. */
  async get(actor: StoragePolicyActor): Promise<StoragePolicyDto> {
    const manager = this.dataSource.manager;
    const model = await this.organizations.findDeploymentModel(manager, actor.organizationId);
    if (model === null) throw organizationNotFoundError();

    const available = await this.destinationDefaults.listAvailable(manager, actor.organizationId);
    const defaultRow = await this.destinationDefaults.getDefault(manager, actor.organizationId);
    const defaultIsAvailable = defaultRow !== null && available.some((row) => row.id === defaultRow.id);

    return {
      model,
      defaultDestinationId: defaultIsAvailable ? defaultRow.id : null,
      destinations: available.map((row) => ({ id: row.id, name: row.name, location: row.location })),
    };
  }

  /**
   * SPEC-803 escenarios 2, 3 y 10. Valida todo antes de escribir: si algo falla, la transacción no cambia nada.
   * Tras el commit registra la auditoría y devuelve la política vigente.
   */
  async update(actor: StoragePolicyActor, dto: UpdateStoragePolicyDto): Promise<StoragePolicyDto> {
    const requirement = STORAGE_MODEL_REQUIREMENTS[dto.model];

    await this.dataSource.transaction(async (manager: EntityManager) => {
      const exists = await this.organizations.lockById(manager, actor.organizationId);
      if (!exists) throw organizationNotFoundError();

      const available = await this.destinationDefaults.listAvailable(manager, actor.organizationId);
      const missing = requirement.missingLocations(available);
      if (missing.length > 0) throw requirementsUnmetError(missing);

      const target = available.find((row) => row.id === dto.defaultDestinationId);
      if (!target) throw destinationNotAvailableError();
      if (!requirement.acceptsDefault(target)) throw defaultNotCompatibleError();

      await this.organizations.updateDeploymentModel(manager, actor.organizationId, dto.model);
      await this.destinationDefaults.promoteToDefault(manager, actor.organizationId, target.id);
    });

    this.audit(actor);
    return this.get(actor);
  }

  private audit(actor: StoragePolicyActor): void {
    void this.auditService?.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: AuditAction.DEPLOYMENT_MODEL_CHANGED,
      resourceType: AuditResource.ORGANIZATION,
      resourceId: actor.organizationId,
    });
  }
}
