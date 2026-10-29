/** Código de error seguro para log y para `last_error`. Puede lanzarse cualquier valor (incluido null o undefined). */
export function errorCode(error: unknown): string {
  return (error as { code?: string } | null)?.code ?? 'UNKNOWN';
}
