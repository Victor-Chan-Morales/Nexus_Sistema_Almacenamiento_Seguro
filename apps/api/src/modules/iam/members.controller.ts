import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { Role } from './domain/enums';
import { AddMemberDto } from './dto/add-member.dto';
import { MemberDto, MemberListDto, MemberListItemDto } from './dto/member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthUser } from './interfaces/auth-user.interface';
import { MembersService } from './services/members.service';

/** Un id que no es UUID no puede existir: se responde 404 como a un id ajeno, sin llegar a la base. */
const membershipIdPipe = new ParseUUIDPipe({
  exceptionFactory: () => new NotFoundException({ code: 'NOT_FOUND', message: 'Miembro no encontrado' }),
});

/** Solo traduce HTTP ↔ caso de uso. La organización sale únicamente de req.user (token + membresía). */
@Controller('organizations/members')
@UseGuards(JwtAuthGuard, RolesGuard) // el guard JWT va primero: RolesGuard lee req.user
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @Roles(Role.TENANT_ADMIN)
  list(@CurrentUser() actor: AuthUser): Promise<MemberListDto> {
    return this.members.list(actor);
  }

  @Post()
  @Roles(Role.TENANT_ADMIN)
  addMember(@CurrentUser() actor: AuthUser, @Body() dto: AddMemberDto): Promise<MemberDto> {
    return this.members.addMember(actor, dto);
  }

  @Patch(':id')
  @Roles(Role.TENANT_ADMIN)
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', membershipIdPipe) id: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberListItemDto> {
    return this.members.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.TENANT_ADMIN)
  remove(@CurrentUser() actor: AuthUser, @Param('id', membershipIdPipe) id: string): Promise<void> {
    return this.members.remove(actor, id);
  }
}
