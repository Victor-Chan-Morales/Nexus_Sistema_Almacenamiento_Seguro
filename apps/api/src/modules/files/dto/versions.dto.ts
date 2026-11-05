/** SPEC-206: una versión del historial de un archivo. Solo campos públicos (sin object_key, DEK, KEK ni checksum). */
export class FileVersionItemDto {
  versionId: string;
  versionNumber: number;
  sizeBytes: number;
  uploadedAt: string;
  isCurrent: boolean;
}

/** SPEC-206: respuesta de `GET /files/:id/versions`, de la más reciente a la más antigua. */
export class FileVersionsResponseDto {
  fileId: string;
  fileName: string;
  currentVersion: number;
  versions: FileVersionItemDto[];
}
