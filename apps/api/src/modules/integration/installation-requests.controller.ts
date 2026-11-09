import { Body, Controller, Get, Post, UseFilters, UseGuards } from '@nestjs/common';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { RolesGuard } from '../iam/guards/roles.guard';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import {
  CreateInstallationRequestDto,
  InstallationRequestCreatedDto,
  InstallationRequestListDto,
} from './dto/installation-request.dto';
import { InstallationRequestsService } from './installation-requests.service';

/**
 * SPEC-803 §5: solicitudes de instalación. Solo `tenant_admin`; la organización sale de la sesión.
 * Un controlador aparte de la política de almacenamiento (SRP): tienen reglas y ciclo de vida distintos.
 */
@Controller('organizations/installation-requests')
@UseFilters(ApiExceptionFilter)
@UseGuards(JwtAuthGuard, RolesGuard)
export class InstallationRequestsController {
  constructor(private readonly requests: InstallationRequestsService) {}

  @Post()
  @Roles(Role.TENANT_ADMIN)
  create(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CreateInstallationRequestDto,
  ): Promise<InstallationRequestCreatedDto> {
    return this.requests.create({ organizationId: actor.organizationId, userId: actor.userId }, dto);
  }

  @Get()
  @Roles(Role.TENANT_ADMIN)
  list(@CurrentUser() actor: AuthUser): Promise<InstallationRequestListDto> {
    return this.requests.list({ organizationId: actor.organizationId, userId: actor.userId });
  }
}
