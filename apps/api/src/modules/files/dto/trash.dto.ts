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