import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { DeploymentModel } from '../../iam/domain/enums';
import { destinationSelectionNotAllowedError, destinationNotAvailableError } from '../destination-errors';
import { DestinationLocation } from '../dto/destination.dto';
import { Destination } from '../entities/destination.entity';
import { DeploymentModelSource } from '../ports/deployment-model-source';
import { ROOT_PLACEMENT_BY_MODEL } from './root-placement.strategy';

/** Datos del padre que deciden el destino de la carpeta nueva. */
export interface PlacementParent {
  /** null cuando el padre es la raíz del Drive. */
  parentId: string | null;
  destinationId: string | null;
}

export interface PlacementInput {
  organizationId: string;
  parent: PlacementParent;
  /** Destino pedido en la solicitud. Ausente o vacío significa predeterminado o herencia. */
  requestedDestinationId?: string;
  /** Destino predeterminado de la organización (SPEC-803). */
  defaultDestination: Destination;
}

/**
 * Decide en qué destino nace una carpeta nueva (SPEC-803).
 * - Subcarpeta: hereda el destino de su padre. Pedir otro destino responde 422.
 * - Carpeta principal (hija directa de la raíz del Drive): la estrategia del modelo de la organización decide.
 */
@Injectable()
export class FolderPlacementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly deploymentModels: DeploymentModelSource,
  ) {}

  async resolveForNewFolder(manager: EntityManager, input: PlacementInput): Promise<Destination> {
    if (input.parent.parentId !== null) return this.inheritFromParent(manager, input);
    return this.resolveRootPlacement(manager, input);
  }

  /**
   * Ubicación (cloud / on_premises) de varios destinos con una sola consulta. Los null se ignoran y
   * un destino de otra organización no aparece en el mapa.
   */
  async locationsOf(organizationId: string, destinationIds: Array<string | null>): Promise<Map<string, DestinationLocation>> {
    const ids = [...new Set(destinationIds.filter((id): id is string => Boolean(id)))];
    const locations = new Map<string, DestinationLocation>();
    if (ids.length === 0) return locations;

    const destinations = await this.dataSource.getRepository(Destination).find({
      select: { id: true, location: true },
      where: { organizationId, id: In(ids) },
    });
    for (const destination of destinations) locations.set(destination.id, destination.location);
    return locations;
  }

  /** Subcarpeta: se valida antes de consultar nada, y después hereda el destino del padre. */
  private async inheritFromParent(manager: EntityManager, input: PlacementInput): Promise<Destination> {
    if (input.requestedDestinationId) throw destinationSelectionNotAllowedError();
    if (!input.parent.destinationId) return input.defaultDestination;

    const inherited = await manager.findOne(Destination, {
      where: { id: input.parent.destinationId, organizationId: input.organizationId },
    });
    if (!inherited) throw destinationNotAvailableError();
    return inherited;
  }

  /** Carpeta principal: el modelo de la organización elige la estrategia. Sin modelo, se trata como cloud. */
  private async resolveRootPlacement(manager: EntityManager, input: PlacementInput): Promise<Destination> {
    const model = (await this.deploymentModels.findDeploymentModel(manager, input.organizationId)) ?? DeploymentModel.CLOUD;
    return ROOT_PLACEMENT_BY_MODEL[model].resolve({
      manager,
      organizationId: input.organizationId,
      requestedDestinationId: input.requestedDestinationId,
      defaultDestination: input.defaultDestination,
    });
  }
}
