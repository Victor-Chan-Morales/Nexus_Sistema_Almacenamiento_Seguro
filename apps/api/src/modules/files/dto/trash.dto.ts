export class TrashItemDto {
  id: string;
  name: string;
  mimeType: string;
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
