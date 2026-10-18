export const REFRESH_COOKIE_NAME = 'nexus_rt';
/** La cookie solo viaja a las rutas de autenticación (prefijo global /api). */
export const REFRESH_COOKIE_PATH = '/api/auth';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutos
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const VERIFICATION_TOKEN_TTL_MINUTES = 15;

/**
 * Página web que recibe el enlace del correo de verificación. SESSION_LOG.md (2026-09-29) registra la ruta
 * `/verificar-correo`. Se puede cambiar con IAM_VERIFY_EMAIL_PATH sin tocar código.
 */
export const DEFAULT_VERIFY_EMAIL_PATH = '/verificar-correo';
