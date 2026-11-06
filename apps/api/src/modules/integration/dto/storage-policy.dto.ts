import { IsIn, IsUUID } from 'class-validator';
import type { DestinationLocation } from '../../files/dto/destination.dto';
import { DeploymentModel } from '../../iam/domain/enums';

/** SPEC-803 §5: cuerpo de `PUT /organizations/storage-policy`. La organización nunca viaja aquí: sale de la sesión. */
export class UpdateStoragePolicyDto {
  @IsIn(Object.values(DeploymentModel))
  model!: DeploymentModel;

  @IsUUID()
  defaultDestinationId!: string;
}

/**
 * Destino que se ofrece para elegir. Solo los campos públicos: sin endpoint, bucket, región ni credenciales,
 * y sin el estado de conexión (solo entran los disponibles, que ya están "Conectado").
 */
export interface StoragePolicyDestinationDto {
  id: string;
  name: string;
  location: DestinationLocation;
}

/** Respuesta de `GET` y `PUT /organizations/storage-policy`. */
export interface StoragePolicyDto {
  model: DeploymentModel;
  /** Predeterminado, si está entre los destinos disponibles; si no, null. */
  defaultDestinationId: string | null;
  destinations: StoragePolicyDestinationDto[];
}
