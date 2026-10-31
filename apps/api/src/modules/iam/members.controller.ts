import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from './decorators/current-user.decorator';
import { Roles } from './decorators/roles.decorator';
import { Role } from './domain/enums';
import { AddMemberDto } from './dto/add-member.dto';
import { MemberDto, MemberListDto } from './dto/member.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthUser } from './interfaces/auth-user.interface';
import { MembersService } from './services/members.service';

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
}
