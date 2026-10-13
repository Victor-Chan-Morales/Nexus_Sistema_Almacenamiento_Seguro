export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const addMinutes = (minutes: number): Date => new Date(Date.now() + minutes * 60_000);

export const addDays = (days: number): Date => new Date(Date.now() + days * 86_400_000);

/** Violación de restricción UNIQUE de PostgreSQL (código 23505). */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; driverError?: { code?: string } };
  return e.code === '23505' || e.driverError?.code === '23505';
}

/** Lee una cookie del header `Cookie` sin agregar paquetes (la lectura es trivial; escribir usa res.cookie de Express). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
