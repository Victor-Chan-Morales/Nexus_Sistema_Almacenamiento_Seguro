/** Entrega del enlace de verificación (hoy SMTP: Mailpit/Mailtrap en desarrollo, ADR-003). */
export abstract class VerificationMailer {
  abstract sendVerification(to: string, fullName: string, token: string): Promise<void>;
}
