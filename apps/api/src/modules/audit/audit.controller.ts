import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { RolesGuard } from '../iam/guards/roles.guard';
import { AuditService } from './audit.service';
import {
  AuditEventsResponseDto,
  ListAuditEventsQueryDto,
} from './dto/list-audit-events.dto';

/**
 * AuditController
 *
 * GET /api/audit/events -> Consulta de bitácora restringida a tenant_admin (SPEC-402)
 */
@Controller('audit')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('events')
  @Roles(Role.TENANT_ADMIN)
  async getEvents(
    @Request() req: any,
    @Query() query: ListAuditEventsQueryDto,
  ): Promise<AuditEventsResponseDto> {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException(
        'La sesión no tiene una organización activa válida',
      );
    }

    return this.auditService.listEvents(organizationId, query);
  }
}
