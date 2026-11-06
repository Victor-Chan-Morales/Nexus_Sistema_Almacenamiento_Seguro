import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { SuperAdminGuard } from '../iam/guards/super-admin.guard';
import {
  PlatformAdminService,
  PlatformMetrics,
  PlatformOrganizationsPage,
} from './platform-admin.service';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Query de GET /platform/organizations. No acepta ningún otro parámetro (forbidNonWhitelisted). */
export class PlatformOrganizationsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/**
 * Consultas de plataforma, solo para el Super Admin (SPEC-501). El guard JWT va primero: sin sesión responde 401;
 * con sesión pero sin is_super_admin, 403 PLATFORM_ADMIN_REQUIRED. Solo lectura y ninguna ruta recibe organizationId.
 */
@Controller('platform')
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformAdminService) {}

  @Get('organizations')
  listOrganizations(@Query() query: PlatformOrganizationsQuery): Promise<PlatformOrganizationsPage> {
    return this.platform.listOrganizations(query.limit ?? DEFAULT_PAGE_SIZE, query.offset ?? 0);
  }

  @Get('metrics')
  getMetrics(): Promise<PlatformMetrics> {
    return this.platform.getMetrics();
  }
}
