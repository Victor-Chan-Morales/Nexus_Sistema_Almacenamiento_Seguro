import { EntityManager } from 'typeorm';
import { DeploymentModel } from '../../iam/domain/enums';
import { destinationNotAvailableError, destinationSelectionNotAllowedError } from '../destination-errors';
import { Destination } from '../entities/destination.entity';

/** Lo que necesita una estrategia para decidir el destino de una carpeta principal nueva (SPEC-803). */
export interface RootPlacementContext {
  manager: EntityManager;
  organizationId: string;
  /** Destino pedido en la solicitud. Ausente o vacío significa usar el predeterminado. */
  requestedDestinationId?: string;
  /** Destino predeterminado de la organización. */
  defaultDestination: Destination;
}

/** Strategy (SPEC-803): cada modelo de despliegue decide el destino de sus carpetas principales. */
export interface RootPlacementStrategy {
  resolve(context: RootPlacementContext): Promise<Destination>;
}

/** cloud y on_premises: la carpeta usa siempre el predeterminado; el cliente no elige destino. */
export class DefaultRootPlacement implements RootPlacementStrategy {
  async resolve({ requestedDestinationId, defaultDestination }: RootPlacementContext): Promise<Destination> {
    if (requestedDestinationId) throw destinationSelectionNotAllowedError();
    return defaultDestination;
  }
}

/**
 * hybrid: la carpeta principal usa el destino elegido o, si no se elige ninguno, el predeterminado.
 * El destino elegido debe ser de la organización, estar habilitado y "Conectado".
 */
export class HybridRootPlacement implements RootPlacementStrategy {
  async resolve({ manager, organizationId, requestedDestinationId, defaultDestination }: RootPlacementContext): Promise<Destination> {
    if (!requestedDestinationId) return defaultDestination;
    const destination = await manager.findOne(Destination, {
      where: { id: requestedDestinationId, organizationId, isEnabled: true, connectionStatus: 'Conectado' },
    });
    if (!destination) throw destinationNotAvailableError();
    return destination;
  }
}

const defaultRootPlacement = new DefaultRootPlacement();
const hybridRootPlacement = new HybridRootPlacement();

/** OCP: un modelo nuevo es una estrategia nueva y una entrada aquí; el servicio de carpetas no cambia. */
export const ROOT_PLACEMENT_BY_MODEL: Record<DeploymentModel, RootPlacementStrategy> = {
  [DeploymentModel.CLOUD]: defaultRootPlacement,
  [DeploymentModel.ON_PREMISES]: defaultRootPlacement,
  [DeploymentModel.HYBRID]: hybridRootPlacement,
};
