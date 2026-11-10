export interface PostgresSslOptions {
  rejectUnauthorized: true;
  ca?: string;
}

/**
 * SPEC-807: decide si la conexión a PostgreSQL usa TLS.
 * Función pura: recibe lectores de variables y de archivos para poder probarla sin entorno real.
 * Un valor vacío cuenta como "no definida" (D1 del plan): POSTGRES_SSL vacío equivale a false.
 */
export function buildPostgresSsl(
  get: (key: string) => string | undefined,
  readFile: (path: string) => string,
): false | PostgresSslOptions {
  const mode = get('POSTGRES_SSL')?.trim();
  if (!mode || mode === 'false') return false;
  if (mode !== 'true') throw new Error('POSTGRES_SSL debe ser true o false');

  const caPath = get('POSTGRES_SSL_CA')?.trim();
  // Sin CA se usan las autoridades del sistema. No se crea la propiedad `ca` (ni con valor undefined).
  if (!caPath) return { rejectUnauthorized: true };

  try {
    return { rejectUnauthorized: true, ca: readFile(caPath) };
  } catch {
    // No se incluye el error original: podría contener parte del archivo. Sí se nombra la variable.
    throw new Error('POSTGRES_SSL_CA no se pudo leer: revise que la ruta exista y sea legible');
  }
}
