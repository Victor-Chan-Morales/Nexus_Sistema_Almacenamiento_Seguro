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
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
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
  PlatformPlanItem,
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
 * Cuerpo de PATCH /platform/plans/:id (SPEC-504). Todos los campos son opcionales, pero se usa ValidateIf y no
 * IsOptional: IsOptional dejaría pasar un null, que llegaría a la BD como NOT NULL (500); con ValidateIf el null se
 * valida y responde 400. Que el cuerpo tenga al menos un campo lo comprueba el servicio.
 */
export class UpdatePlatformPlanDto {
  @ValidateIf((o: UpdatePlatformPlanDto) => o.priceMonthly !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  priceMonthly?: number;

  @ValidateIf((o: UpdatePlatformPlanDto) => o.storageLimitGb !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  storageLimitGb?: number;

  @ValidateIf((o: UpdatePlatformPlanDto) => o.userLimit !== undefined)
  @IsInt()
  @Min(1)
  @Max(2147483647)
  userLimit?: number;

  @ValidateIf((o: UpdatePlatformPlanDto) => o.description !== undefined)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;
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

  @Patch('plans/:id')
  updatePlan(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdatePlatformPlanDto,
  ): Promise<PlatformPlanItem> {
    return this.platform.updatePlan(actor, id, body);
  }
}
