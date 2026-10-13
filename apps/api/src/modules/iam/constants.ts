export const REFRESH_COOKIE_NAME = 'nexus_rt';
/** La cookie solo viaja a las rutas de autenticación (prefijo global /api). */
export const REFRESH_COOKIE_PATH = '/api/auth';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutos
export const REFRESH_TOKEN_TTL_DAYS = 7;
export const VERIFICATION_TOKEN_TTL_MINUTES = 15;
