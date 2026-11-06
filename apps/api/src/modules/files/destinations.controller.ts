import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { RolesGuard } from '../iam/guards/roles.guard';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import {
  CreateDestinationDto,
  DestinationDto,
  DestinationListDto,
  DestinationTestResultDto,
  UpdateDestinationDto,
} from './dto/destination.dto';
import { DestinationsService } from './destinations.service';

/**
 * SPEC-802: administración de destinos. Todas las rutas son solo para `tenant_admin`.
 * La organización sale de req.user, nunca del cuerpo de la solicitud.
 */
@Controller('destinations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DestinationsController {
  constructor(private readonly destinations: DestinationsService) {}

  @Post()
  @Roles(Role.TENANT_ADMIN)
  create(@CurrentUser() actor: AuthUser, @Body() dto: CreateDestinationDto): Promise<DestinationDto> {
    return this.destinations.create(dto, { organizationId: actor.organizationId, userId: actor.userId });
  }

  @Get()
  @Roles(Role.TENANT_ADMIN)
  list(@CurrentUser() actor: AuthUser): Promise<DestinationListDto> {
    return this.destinations.list({ organizationId: actor.organizationId, userId: actor.userId });
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDestinationDto,
  ): Promise<DestinationDto> {
    return this.destinations.update(id, dto, { organizationId: actor.organizationId, userId: actor.userId });
  }

  /** Escribe, lee, compara y borra un objeto de prueba. Responde 200 con el resultado, también cuando la conexión falla. */
  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.TENANT_ADMIN)
  test(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DestinationTestResultDto> {
    return this.destinations.testConnection(id, { organizationId: actor.organizationId, userId: actor.userId });
  }
}
