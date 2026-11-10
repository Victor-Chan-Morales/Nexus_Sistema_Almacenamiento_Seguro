import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { SuperAdminGuard } from '../iam/guards/super-admin.guard';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { InstallationStatus } from './entities/installation.entity';
import { InstallationRequestStatus } from './entities/installation-request.entity';
import { InstallationRequestAdminItem, PlatformActionsService } from './platform-actions.service';
import {
  PlatformAdminService,
  PlatformMetrics,
  PlatformOrganizationsPage,
} from './platform-admin.service';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const REQUEST_STATUSES: readonly InstallationRequestStatus[] = ['Pendiente', 'Aprobada', 'Rechazada', 'Cerrada'];
const INSTALLATION_STATUSES: readonly InstallationStatus[] = [
  'No solicitada',
  'Pendiente',
  'En proceso',
  'Operativa',
  'Fallida',
];

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

/** Query de GET /platform/installation-requests (SPEC-503 §5). Solo `status`; cualquier otro valor es 400. */
export class PlatformInstallationRequestsQuery {
  @IsOptional()
  @IsIn(REQUEST_STATUSES)
  status?: InstallationRequestStatus;
}

/** Cuerpo de POST /platform/installation-requests/:id/approve (SPEC-503 §5). */
export class ApprovePlatformInstallationRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  operatorName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  hostReference?: string;
}

/** Cuerpo de PATCH /platform/installations/:id. La validez de la transición la decide el servicio (422). */
export class UpdatePlatformInstallationStatusDto {
  @IsIn(INSTALLATION_STATUSES)
  status!: InstallationStatus;
}

/**
 * Consultas y acciones de plataforma, solo para el Super Admin (SPEC-501, SPEC-503). El guard JWT va primero:
 * sin sesión responde 401; con sesión pero sin is_super_admin, 403 PLATFORM_ADMIN_REQUIRED.
 * Ninguna ruta recibe organizationId del cliente: la organización afectada sale del `:id` del recurso.
 * El controlador solo enruta y delega; la lógica vive en PlatformAdminService y PlatformActionsService.
 */
@Controller('platform')
@UseGuards(AuthGuard('jwt'), SuperAdminGuard)
export class PlatformController {
  constructor(
    private readonly platform: PlatformAdminService,
    private readonly actions: PlatformActionsService,
  ) {}

  @Get('organizations')
  listOrganizations(@Query() query: PlatformOrganizationsQuery): Promise<PlatformOrganizationsPage> {
    return this.platform.listOrganizations(query.limit ?? DEFAULT_PAGE_SIZE, query.offset ?? 0);
  }

  @Get('metrics')
  getMetrics(): Promise<PlatformMetrics> {
    return this.platform.getMetrics();
  }

  @Post('organizations/:id/suspend')
  @HttpCode(HttpStatus.OK)
  suspendOrganization(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ id: string; status: 'suspended' }> {
    return this.actions.suspendOrganization(actor, id);
  }

  @Post('organizations/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  reactivateOrganization(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ id: string; status: 'active' }> {
    return this.actions.reactivateOrganization(actor, id);
  }

  @Get('installation-requests')
  listInstallationRequests(
    @Query() query: PlatformInstallationRequestsQuery,
  ): Promise<{ items: InstallationRequestAdminItem[] }> {
    return this.actions.listInstallationRequests(query.status);
  }

  @Post('installation-requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveInstallationRequest(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ApprovePlatformInstallationRequestDto,
  ): Promise<{ requestId: string; installationId: string }> {
    return this.actions.approveInstallationRequest(actor, id, body);
  }

  @Post('installation-requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectInstallationRequest(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ requestId: string; status: 'Rechazada' }> {
    return this.actions.rejectInstallationRequest(actor, id);
  }

  @Patch('installations/:id')
  updateInstallationStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePlatformInstallationStatusDto,
  ): Promise<{ id: string; status: InstallationStatus }> {
    return this.actions.updateInstallationStatus(actor, id, body.status);
  }
}
