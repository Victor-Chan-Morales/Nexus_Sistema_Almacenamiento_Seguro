/**
 * Política de reintento de los outbox. Sondeo y espera son comunes (correo de IAM y auditoría).
 * El horizonte de abandono es solo del correo: un evento de auditoría nunca se descarta por transitorio (SPEC-401, I1).
 */

export const OUTBOX_POLL_INTERVAL_MS = 30_000;
const MAX_BACKOFF_SECONDS = 30 * 60;
/** Solo correo. Tiempo máximo que se insiste con un mensaje desde su captura; después se abandona. */
const RETRY_HORIZON_MS = 24 * 60 * 60 * 1000;

/** Espera antes del siguiente intento: crece con cada fallo y se topa en 30 minutos. */
export function outboxBackoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** attempts, MAX_BACKOFF_SECONDS);
}

/** Solo correo. Si el horizonte ya pasó en el instante `at`, el mensaje se abandona en lugar de reintentarse. */
export function outboxHorizonPassed(capturedAt: Date, at: number): boolean {
  return capturedAt.getTime() + RETRY_HORIZON_MS <= at;
}
