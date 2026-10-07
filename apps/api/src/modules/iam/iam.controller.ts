import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards, Request } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IamService } from './iam.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/**
 * IamController — expone los endpoints de autenticación.
 *
 * Rutas disponibles (prefijo global /api):
 *   POST /api/auth/register  → Registro de usuario
 *   POST /api/auth/login     → Login, devuelve JWT
 */
@Controller('auth')
export class IamController {
  constructor(private readonly iamService: IamService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.iamService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.iamService.login(dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  getCurrentUser(@Request() req) {
    return this.iamService.getCurrentUser(req.user.userId);
  }
}
