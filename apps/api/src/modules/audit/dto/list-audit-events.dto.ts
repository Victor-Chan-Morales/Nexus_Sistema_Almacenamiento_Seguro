import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class ListAuditEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @IsISO8601()
  before?: string;
}

export class AuditEventItemDto {
  id!: string;
  action!: string;
  resourceType!: string | null;
  resourceId!: string | null;
  actorId!: string | null;
  result!: string;
  occurredAt!: string;
}

export class AuditEventsResponseDto {
  items!: AuditEventItemDto[];
  nextBefore!: string | null;
}