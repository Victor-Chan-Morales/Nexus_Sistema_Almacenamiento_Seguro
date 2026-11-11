import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountNoticeKind,
  DEFAULT_RESET_PASSWORD_PATH,
  DEFAULT_VERIFY_EMAIL_PATH,
  MEMBER_INVITATION_TOKEN_TTL_HOURS,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
  VERIFICATION_TOKEN_TTL_MINUTES,
} from '../constants';
import { buildVerificationLink } from '../iam.utils';
import { VerificationMailer } from '../ports/verification-mailer';
import { createMailTransport, MailTransport } from './mail-transport';
import { renderNexusEmail } from './nexus-email-template';

const ACCOUNT_NOTICE_COPY: Record<AccountNoticeKind, { subject: string; text: string }> = {
  plan_changed: {
    subject: 'Suscripción actualizada en Nexus',
    text: 'Se actualizó la suscripción de tu organización. Puedes consultar su estado en la sección Suscripción de Nexus.',
  },
  member_status_changed: {
    subject: 'Acceso a tu organización actualizado en Nexus',
    text: 'Tu organización suspendió o retiró tu acceso a Nexus. Si necesitas más información, contacta a tu administrador.',
  },
  organization_closed: {
    subject: 'Organización cerrada en Nexus',
    text: 'Tu organización cerró su cuenta en Nexus. El acceso quedó deshabilitado y los archivos se conservan.',
  },
};

/**
 * Compone los correos de VerificationMailer y registra el resultado sin datos del mensaje.
 */
@Injectable()
export class EmailService implements VerificationMailer {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: MailTransport;

  constructor(private readonly config: ConfigService) {
    this.transporter = createMailTransport({
      NODE_ENV: config.get<string>('NODE_ENV'),
      MAIL_TRANSPORT: config.get<string>('MAIL_TRANSPORT'),
      GMAIL_SENDER: config.get<string>('GMAIL_SENDER'),
      GMAIL_CLIENT_ID: config.get<string>('GMAIL_CLIENT_ID'),
      GMAIL_CLIENT_SECRET: config.get<string>('GMAIL_CLIENT_SECRET'),
      GMAIL_REFRESH_TOKEN: config.get<string>('GMAIL_REFRESH_TOKEN'),
      MAIL_HOST: config.get<string>('MAIL_HOST'),
      MAIL_PORT: config.get<string>('MAIL_PORT'),
      MAIL_SECURE: config.get<string>('MAIL_SECURE'),
      MAIL_REQUIRE_TLS: config.get<string>('MAIL_REQUIRE_TLS'),
      MAIL_USER: config.get<string>('MAIL_USER'),
      MAIL_PASS: config.get<string>('MAIL_PASS'),
      MAIL_FROM: config.get<string>('MAIL_FROM'),
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
      html: renderNexusEmail({
        heading: 'Verifica tu correo',
        greeting: `Hola ${fullName},`,
        message: 'Confirma tu dirección de correo para activar tu cuenta en Nexus.',
        action: {
          label: 'Verificar correo', url: link,
          detail: `El enlace vence en ${VERIFICATION_TOKEN_TTL_MINUTES} minutos y solo se puede usar una vez.`,
        },
        note: 'Si no creaste esta cuenta, ignora este mensaje.',
      }),
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
      html: renderNexusEmail({
        heading: 'Restablece tu contraseña',
        greeting: `Hola ${fullName},`,
        message: 'Abre el enlace para elegir una nueva contraseña para tu cuenta de Nexus.',
        action: {
          label: 'Restablecer contraseña', url: link,
          detail: `El enlace vence en ${PASSWORD_RESET_TOKEN_TTL_MINUTES} minutos y solo se puede usar una vez.`,
        },
        note: 'Si no lo solicitaste, ignora este mensaje. Tu contraseña seguirá siendo la misma.',
      }),
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
      html: renderNexusEmail({
        heading: 'Te invitaron a Nexus',
        greeting: `Hola ${fullName},`,
        message: 'Te invitaron a unirte a una organización. Define tu contraseña para acceder a Nexus.',
        action: {
          label: 'Definir contraseña', url: link,
          detail: `El enlace vence en ${MEMBER_INVITATION_TOKEN_TTL_HOURS} horas y solo se puede usar una vez.`,
        },
        note: 'Si no esperabas esta invitación, ignora este mensaje.',
      }),
    });
    this.logger.log('Correo de invitación enviado');
  }

  async sendAccountNotice(to: string, kind: AccountNoticeKind): Promise<void> {
    const { subject, text } = ACCOUNT_NOTICE_COPY[kind];
    await this.send(to, subject, { text, html: renderNexusEmail({ heading: subject, message: text }) });
  }

  private linkTo(path: string, token: string): string {
    const webUrl = this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
    return buildVerificationLink(webUrl, path, token);
  }

  private async send(to: string, subject: string, body: { text: string; html: string }): Promise<void> {
    await this.transporter.sendMail({ to, subject, ...body });
  }
}
