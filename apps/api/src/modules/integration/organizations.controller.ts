import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { Roles } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { JwtAuthGuard } from '../iam/guards/jwt-auth.guard';
import { RolesGuard } from '../iam/guards/roles.guard';
import { IamSettings } from '../iam/iam.settings';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../iam/constants';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { CloseOrganizationDto } from './dto/close-organization.dto';
import { OrganizationClosureService } from './organization-closure.service';

/**
 * OrganizationsController — SPEC-114
 *
 * Endpoint POST /api/organizations/close restringido exclusivamente a tenant_admin.
 */
@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrganizationsController {
  constructor(
    private readonly closureService: OrganizationClosureService,
    private readonly settings: IamSettings,
  ) {}

  @Post('close')
  @Roles(Role.TENANT_ADMIN)
  @HttpCode(HttpStatus.OK)
  async close(
    @CurrentUser() actor: AuthUser,
    @Body() dto: CloseOrganizationDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ closed: true }> {
    const result = await this.closureService.close(actor, dto);
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
    return result;
  }

  private cookieOptions(): CookieOptions {
    const { secure, sameSite } = this.settings.refreshCookie;
    return {
      httpOnly: true,
      secure,
      sameSite,
      path: REFRESH_COOKIE_PATH,
    };
  }
}
