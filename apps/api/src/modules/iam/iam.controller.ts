import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, REFRESH_TOKEN_TTL_DAYS } from './constants';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthResult } from './domain/auth-result';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { IamSettings } from './iam.settings';
import { readCookie } from './iam.utils';
import {
  AuthUser,
  LoginResponse,
  MeResponse,
  RegisterResponse,
} from './interfaces/auth-user.interface';
import { AuthService } from './services/auth.service';
import { PasswordResetService } from './services/password-reset.service';
import { RegistrationService } from './services/registration.service';
import { SessionService } from './services/session.service';

/** Solo traduce HTTP ↔ casos de uso. Ninguna ruta lee organizationId del cliente. */
@Controller('auth')
export class IamController {
  constructor(
    private readonly auth: AuthService,
    private readonly registration: RegistrationService,
    private readonly sessions: SessionService,
    private readonly settings: IamSettings,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<RegisterResponse> {
    return this.registration.register(dto);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<{ verified: true }> {
    await this.auth.verifyEmail(dto.token);
    return { verified: true };
  }

  /** Pública. Respuesta idéntica exista o no el correo (anti-enumeración). */
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.passwordReset.requestReset(dto.email);
    return { message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.passwordReset.reset(dto.token, dto.newPassword);
    return { message: 'Contraseña actualizada. Ya puedes iniciar sesión.' };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    return this.deliver(res, await this.auth.authenticate(dto.email, dto.password));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    try {
      const result = await this.sessions.refresh(readCookie(req.headers.cookie, REFRESH_COOKIE_NAME));
      return this.deliver(res, result);
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions(false));
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(readCookie(req.headers.cookie, REFRESH_COOKIE_NAME));
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions(false));
  }

  /** El contexto ya fue validado contra la membresía en JwtStrategy: no hay consulta adicional ni dato del cliente. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): MeResponse {
    return {
      user: { id: user.userId, fullName: user.fullName, email: user.email },
      organization: { id: user.organizationId, name: user.organizationName },
      role: user.role,
    };
  }

  // ───────────── Traducción a HTTP ─────────────

  private deliver(res: Response, result: AuthResult): LoginResponse {
    res.cookie(REFRESH_COOKIE_NAME, result.refreshToken, this.cookieOptions(true));
    return {
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      user: result.user,
      organization: result.organization,
      role: result.role,
    };
  }

  private cookieOptions(withMaxAge: boolean): CookieOptions {
    const { secure, sameSite } = this.settings.refreshCookie;
    return {
      httpOnly: true,
      secure,
      sameSite,
      path: REFRESH_COOKIE_PATH,
      ...(withMaxAge ? { maxAge: REFRESH_TOKEN_TTL_DAYS * 86_400_000 } : {}),
    };
  }
}
