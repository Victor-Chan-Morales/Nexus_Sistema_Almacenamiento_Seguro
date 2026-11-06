import { IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * SPEC-803: cuerpo de `POST /folders`. Conserva `parentId` y `parentFolderId` porque la web envía `parentFolderId`.
 * La longitud y el formato del nombre los valida el servicio, con su mensaje actual.
 * `destinationId` solo se admite en carpetas principales de un modelo híbrido; en otros casos responde 422.
 */
export class CreateFolderDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  parentFolderId?: string;

  @IsOptional()
  @IsUUID()
  destinationId?: string;
}
