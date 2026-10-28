import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  DEFAULT_RESET_PASSWORD_PATH,
  DEFAULT_VERIFY_EMAIL_PATH,
  MEMBER_INVITATION_TOKEN_TTL_HOURS,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
  VERIFICATION_TOKEN_TTL_MINUTES,
} from '../constants';
import { buildVerificationLink } from '../iam.utils';
import { VerificationMailer } from '../ports/verification-mailer';

/**
 * EmailService del plan: implementación SMTP de VerificationMailer. En desarrollo apunta a
 * Mailpit (localhost:1025) o Mailtrap por variables de entorno (ADR-003). Nunca registra el token ni el enlace.
 */
@Injectable()
export class EmailService implements VerificationMailer {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter;

  constructor(private readonly config: ConfigService) {
    const user = this.config.get<string>('MAIL_USER');
    this.transporter = nodemailer.createTransport({
      host: this.config.get<string>('MAIL_HOST') ?? 'localhost',
      port: Number(this.config.get<string>('MAIL_PORT') ?? 1025),
      secure: this.config.get<string>('MAIL_SECURE') === 'true',
      auth: user ? { user, pass: this.config.get<string>('MAIL_PASS') } : undefined,
    });
  }

  async sendVerification(to: string, fullName: string, token: string): Promise<void> {
    const path = this.config.get<string>('IAM_VERIFY_EMAIL_PATH') ?? DEFAULT_VERIFY_EMAIL_PATH;
    const link = this.linkTo(path, token);

    await this.send(to, 'Verifica tu correo en Nexus', {
      text:
        `Hola ${fullName},\n\nConfirma tu correo con este enlace (vence en ` +
        `${VERIFICATION_TOKEN_TTL_MINUTES} minutos y solo sirve una vez):\n${link}\n\n` +
        `Si no creaste esta cuenta, ignora este mensaje.`,
      html:
        `<p>Hola ${escapeHtml(fullName)},</p>` +
        `<p>Confirma tu correo con este enlace (vence en ${VERIFICATION_TOKEN_TTL_MINUTES} ` +
        `minutos y solo sirve una vez):</p><p><a href="${link}">Verificar correo</a></p>` +
        `<p>Si no creaste esta cuenta, ignora este mensaje.</p>`,
    });
    this.logger.log('Correo de verificación enviado');
  }

  async sendPasswordReset(to: string, fullName: string, token: string): Promise<void> {
    const link = this.linkTo(DEFAULT_RESET_PASSWORD_PATH, token);

    await this.send(to, 'Restablece tu contraseña de Nexus', {
      text:
        `Hola ${fullName},\n\nRestablece tu contraseña con este enlace (vence en ` +
        `${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutos y solo sirve una vez):\n${link}\n\n` +
        `Si no lo solicitaste, ignora este mensaje: tu contraseña no cambiará.`,
      html:
        `<p>Hola ${escapeHtml(fullName)},</p>` +
        `<p>Restablece tu contraseña con este enlace (vence en ${PASSWORD_RESET_TOKEN_TTL_MINUTES} ` +
        `minutos y solo sirve una vez):</p><p><a href="${link}">Restablecer contraseña</a></p>` +
        `<p>Si no lo solicitaste, ignora este mensaje: tu contraseña no cambiará.</p>`,
    });
    this.logger.log('Correo de recuperación de contraseña enviado');
  }

  async sendMemberInvitation(to: string, fullName: string, token: string): Promise<void> {
    const link = this.linkTo(DEFAULT_RESET_PASSWORD_PATH, token);

    await this.send(to, 'Te invitaron a Nexus', {
      text:
        `Hola ${fullName},\n\nTe invitaron a unirte a una organización en Nexus. Define tu contraseña ` +
        `con este enlace (vence en ${MEMBER_INVITATION_TOKEN_TTL_HOURS} horas y solo sirve una vez):\n${link}\n\n` +
        `Si no esperabas esta invitación, ignora este mensaje.`,
      html:
        `<p>Hola ${escapeHtml(fullName)},</p>` +
        `<p>Te invitaron a unirte a una organización en Nexus. Define tu contraseña con este enlace ` +
        `(vence en ${MEMBER_INVITATION_TOKEN_TTL_HOURS} horas y solo sirve una vez):</p>` +
        `<p><a href="${link}">Definir contraseña</a></p>` +
        `<p>Si no esperabas esta invitación, ignora este mensaje.</p>`,
    });
    this.logger.log('Correo de invitación enviado');
  }

  private linkTo(path: string, token: string): string {
    const webUrl = this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
    return buildVerificationLink(webUrl, path, token);
  }

  private async send(to: string, subject: string, body: { text: string; html: string }): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM') ?? 'Nexus <no-reply@nexus.local>';
    await this.transporter.sendMail({ from, to, subject, ...body });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
