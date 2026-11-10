import type { AccountNoticeKind } from '../constants';

/** Entrega de enlaces y avisos por correo (SMTP en desarrollo, ADR-003). */
export abstract class VerificationMailer {
  abstract sendVerification(to: string, fullName: string, token: string): Promise<void>;
  abstract sendPasswordReset(to: string, fullName: string, token: string): Promise<void>;
  abstract sendMemberInvitation(to: string, fullName: string, token: string): Promise<void>;
  abstract sendAccountNotice(to: string, kind: AccountNoticeKind): Promise<void>;
}
