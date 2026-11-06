import { Body, Controller, Get, Put, UseFilters, UseGuards } from '@nestjs/common';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { RolesGuard } from '../iam/guards/roles.guard';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { StoragePolicyDto, UpdateStoragePolicyDto } from './dto/storage-policy.dto';
import { StoragePolicyService } from './storage-policy.service';

/**
 * SPEC-803 §5: política de almacenamiento de la organización de la sesión.
 * `GET` lo puede leer cualquier miembro (la pantalla lo necesita); `PUT` solo `tenant_admin`.
 * La organización sale de @CurrentUser(), nunca del cuerpo de la solicitud.
 */
@Controller('organizations/storage-policy')
@UseFilters(ApiExceptionFilter)
export class StoragePolicyController {
  constructor(private readonly storagePolicy: StoragePolicyService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() actor: AuthUser): Promise<StoragePolicyDto> {
    return this.storagePolicy.get({ organizationId: actor.organizationId, userId: actor.userId });
  }

  @Put()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.TENANT_ADMIN)
  update(@CurrentUser() actor: AuthUser, @Body() dto: UpdateStoragePolicyDto): Promise<StoragePolicyDto> {
    return this.storagePolicy.update({ organizationId: actor.organizationId, userId: actor.userId }, dto);
  }
}
