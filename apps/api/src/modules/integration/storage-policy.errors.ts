import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { businessError } from '../../common/errors/business-error';
import type { DestinationLocation } from '../files/dto/destination.dto';

const LOCATION_LABEL: Record<DestinationLocation, string> = {
  cloud: 'Nube',
  on_premises: 'Servidor local',
};

/**
 * SPEC-803 escenario 3: 422. Faltan destinos conectados de una ubicación.
 * El mensaje nombra lo que falta para que el Tenant Admin sepa qué conectar.
 */
export function requirementsUnmetError(missing: DestinationLocation[]): HttpException {
  const labels = missing.map((location) => LOCATION_LABEL[location]);
  const list = labels.length === 2 ? `${labels[0]} y de ${labels[1]}` : labels[0];
  return businessError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'DEPLOYMENT_MODEL_REQUIREMENTS_UNMET',
    `Necesitas un destino de ${list} conectado para elegir este modelo`,
  );
}

/** SPEC-803: 422. El destino predeterminado elegido no es de la ubicación que exige el modelo. */
export function defaultNotCompatibleError(): HttpException {
  return businessError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'DEPLOYMENT_MODEL_REQUIREMENTS_UNMET',
    'El destino predeterminado no corresponde a la ubicación que exige este modelo',
  );
}

export function organizationNotFoundError(): NotFoundException {
  return new NotFoundException({ code: 'NOT_FOUND', message: 'Organización no encontrada' });
}
