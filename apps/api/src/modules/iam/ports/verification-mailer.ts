/** Entrega de los enlaces por correo (hoy SMTP: Mailpit/Mailtrap en desarrollo, ADR-003). */
export abstract class VerificationMailer {
  abstract sendVerification(to: string, fullName: string, token: string): Promise<void>;
  abstract sendPasswordReset(to: string, fullName: string, token: string): Promise<void>;
  abstract sendMemberInvitation(to: string, fullName: string, token: string): Promise<void>;
}
