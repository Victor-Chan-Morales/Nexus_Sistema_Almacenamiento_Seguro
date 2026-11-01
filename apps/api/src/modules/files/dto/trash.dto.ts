export class TrashItemDto {
  kind: 'file' | 'folder';
  id: string;
  name: string;
  mimeType?: string;
  parentFolderId?: string | null;
  sizeBytes: number;
  deletedAt: string;
  retentionEndsAt: string;
}

export class TrashResponseDto {
  items: TrashItemDto[];
  totalItems: number;
}

/** SPEC-203: respuesta de `POST /files/:id/restore`. */
export class RestoreFileResponseDto {
  id: string;
  name: string;
  folderId: string;
}

/** Restauración de una carpeta con su árbol de contenido. */
export class RestoreFolderResponseDto {
  id: string;
  name: string;
  parentFolderId: string;
}

/** SPEC-204: respuesta de `DELETE /files/:id/purge`. `freedBytes` suma todas las versiones. */
export class PurgeFileResponseDto {
  id: string;
  freedBytes: number;
}
