import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { CreatedShareLinkDto, CreateShareLinkDto, ShareLinksResponseDto } from './dto/share-link.dto';
import { ShareLinksService } from './share-links.service';

/**
 * SPEC-209: enlaces compartidos. Las rutas son completas porque cada una cuelga de un recurso distinto:
 * el archivo (`files/:id/share-links`) o el enlace (`share-links/:id`).
 */
@Controller()
@UseGuards(AuthGuard('jwt'))
export class ShareLinksController {
  constructor(private readonly shareLinks: ShareLinksService) {}

  /** Crea un enlace a la versión vigente. Es la única respuesta que incluye el `token` en claro. */
  @Post('files/:id/share-links')
  async createLink(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) fileId: string,
    @Body() dto: CreateShareLinkDto,
  ): Promise<CreatedShareLinkDto> {
    return this.shareLinks.createLink(fileId, dto, {
      organizationId: user.organizationId,
      userId: user.userId,
    });
  }

  /** Lista los enlaces del archivo con su estado. Nunca incluye el token ni su hash. */
  @Get('files/:id/share-links')
  async listLinks(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) fileId: string,
  ): Promise<ShareLinksResponseDto> {
    return this.shareLinks.listLinks(fileId, {
      organizationId: user.organizationId,
      userId: user.userId,
    });
  }

  /** Revoca el enlace. Responde 204 también si ya estaba revocado. */
  @Delete('share-links/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeLink(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) linkId: string,
  ): Promise<void> {
    await this.shareLinks.revokeLink(linkId, {
      organizationId: user.organizationId,
      userId: user.userId,
    });
  }
}
