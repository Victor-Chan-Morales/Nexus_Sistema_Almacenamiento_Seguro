import { Destination } from '../files/entities/destination.entity';
import type { DestinationLocation } from '../files/dto/destination.dto';
import { DeploymentModel } from '../iam/domain/enums';

/**
 * SPEC-803 (Strategy): qué exige cada modelo de despliegue para activarse y qué destino puede ser el predeterminado.
 * Los métodos reciben solo los destinos DISPONIBLES (habilitados y "Conectado"): el llamador filtra con
 * DestinationDefaults.listAvailable. Añadir un modelo es añadir una entrada, sin tocar el servicio.
 */
export interface ModelRequirement {
  /** Ubicaciones que deben tener al menos un destino disponible. */
  readonly requiredLocations: readonly DestinationLocation[];
  /** Ubicaciones requeridas que no tienen ningún destino disponible. Vacío si el modelo se cumple. */
  missingLocations(available: Destination[]): DestinationLocation[];
  /** true si los destinos disponibles bastan para activar el modelo. */
  satisfiedBy(available: Destination[]): boolean;
  /** true si este destino puede ser el predeterminado del modelo. */
  acceptsDefault(destination: Destination): boolean;
}

function missingFrom(
  required: readonly DestinationLocation[],
  available: Destination[],
): DestinationLocation[] {
  return required.filter((location) => !available.some((destination) => destination.location === location));
}

/** Modelo de una sola ubicación: cloud y on_premises. El predeterminado debe estar en esa misma ubicación. */
function singleLocation(location: DestinationLocation): ModelRequirement {
  const required = [location] as const;
  return {
    requiredLocations: required,
    missingLocations: (available) => missingFrom(required, available),
    satisfiedBy: (available) => missingFrom(required, available).length === 0,
    acceptsDefault: (destination) => destination.location === location,
  };
}

/** Híbrido: al menos un destino de cada ubicación; el predeterminado puede ser cualquiera disponible. */
const HYBRID_REQUIREMENT: ModelRequirement = {
  requiredLocations: ['cloud', 'on_premises'],
  missingLocations: (available) => missingFrom(['cloud', 'on_premises'], available),
  satisfiedBy: (available) => missingFrom(['cloud', 'on_premises'], available).length === 0,
  acceptsDefault: () => true,
};

export const STORAGE_MODEL_REQUIREMENTS: Readonly<Record<DeploymentModel, ModelRequirement>> = {
  [DeploymentModel.CLOUD]: singleLocation('cloud'),
  [DeploymentModel.ON_PREMISES]: singleLocation('on_premises'),
  [DeploymentModel.HYBRID]: HYBRID_REQUIREMENT,
};
