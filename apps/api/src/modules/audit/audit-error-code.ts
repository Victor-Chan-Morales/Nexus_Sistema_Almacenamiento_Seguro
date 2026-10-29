/** Los códigos de Postgres y de Node son cadenas cortas en mayúsculas (`23503`, `ECONNREFUSED`). Lo demás no se guarda. */
const SAFE_CODE = /^[A-Z0-9_]{1,50}$/;

/** Código de error seguro para log y para `last_error`. Puede lanzarse cualquier valor (incluido null o undefined). */
export function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && SAFE_CODE.test(code) ? code : 'UNKNOWN';
}

/** Errores de Postgres que no mejoran reintentando: FK, NOT NULL, tipo de dato y CHECK. */
const PERMANENT_ERROR_CODES = new Set(['23503', '23502', '22P02', '23514']);

export function isPermanentError(code: string): boolean {
  return PERMANENT_ERROR_CODES.has(code);
}
