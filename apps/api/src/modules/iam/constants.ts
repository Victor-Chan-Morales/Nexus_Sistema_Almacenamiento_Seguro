export const REFRESH_COOKIE_NAME = 'nexus_refresh';
/** La cookie solo viaja a las rutas de autenticación (prefijo global /api). */
export const REFRESH_COOKIE_PATH = '/api/auth';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutos
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const VERIFICATION_TOKEN_TTL_MINUTES = 15;
export const PASSWORD_RESET_TOKEN_TTL_MINUTES = 15;
export const MEMBER_INVITATION_TOKEN_TTL_HOURS = 24;

/** Tipos de mensaje de iam.email_outbox (coinciden con el CHECK ck_email_outbox_kind). */
export const OUTBOX_KINDS = ['email_verification', 'password_reset', 'member_invitation'] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/**
 * Página web que recibe el enlace del correo de verificación. SESSION_LOG.md (2026-09-29) registra la ruta
 * `/verificar-correo`. Se puede cambiar con IAM_VERIFY_EMAIL_PATH sin tocar código.
 */
export const DEFAULT_VERIFY_EMAIL_PATH = '/verificar-correo';

/** Página web que recibe el enlace de recuperación de contraseña y de invitación (SPEC-103, SPEC-102). */
export const DEFAULT_RESET_PASSWORD_PATH = '/nueva-contrasena';
