const DEFAULT_PORT = 3001;
const INVALID_PORT = 'El puerto debe ser un número entre 1 y 65535';

function parsePort(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new Error(INVALID_PORT);
  const port = Number(raw);
  if (port < 1 || port > 65535) throw new Error(INVALID_PORT);
  return port;
}

/**
 * SPEC-807: puerto de escucha. Orden: API_PORT, luego PORT (lo asigna Render), luego 3001.
 * Si API_PORT está definida pero es inválida, falla: no cae silenciosamente a PORT.
 */
export function resolveApiPort(get: (key: string) => string | undefined): number {
  const apiPort = get('API_PORT')?.trim();
  if (apiPort) return parsePort(apiPort);

  const platformPort = get('PORT')?.trim();
  if (platformPort) return parsePort(platformPort);

  return DEFAULT_PORT;
}
