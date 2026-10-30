import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

export class ListAuditEventsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsISO8601()
  before?: string;
}

export class AuditEventResponseDto {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  actorId: string;
  result: string;
  occurredAt: string;
}

export class AuditEventsResponseDto {
  events: AuditEventResponseDto[];
  nextBefore: string | null;
}

export type PaginatedAuditEventsResponseDto = AuditEventsResponseDto;