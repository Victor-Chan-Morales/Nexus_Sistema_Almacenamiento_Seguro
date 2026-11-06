import { HttpException, HttpStatus } from '@nestjs/common';
import { businessError } from '../../common/errors/business-error';

/** SPEC-803: 422. El destino no existe para la organización, está deshabilitado o no está "Conectado". */
export function destinationNotAvailableError(): HttpException {
  return businessError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'DESTINATION_NOT_AVAILABLE',
    'El destino no está disponible: debe estar habilitado y conectado',
  );
}

/** SPEC-803: 422. El modelo elegido no admite elegir destino en esta ubicación (cloud/on_premises o subcarpeta). */
export function destinationSelectionNotAllowedError(): HttpException {
  return businessError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'DESTINATION_SELECTION_NOT_ALLOWED',
    'Esta ubicación usa el destino predeterminado o hereda el de su carpeta principal',
  );
}
