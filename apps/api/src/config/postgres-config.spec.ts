import { buildPostgresSsl } from './postgres-config';

const env = (vars: Record<string, string | undefined>) => (key: string) => vars[key];

describe('buildPostgresSsl (SPEC-807)', () => {
  it('Escenario 1: sin POSTGRES_SSL la conexión no usa SSL', () => {
    const readFile = jest.fn();
    expect(buildPostgresSsl(env({}), readFile)).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('Escenario 1: POSTGRES_SSL=false no usa SSL aunque haya CA definida', () => {
    const readFile = jest.fn();
    expect(buildPostgresSsl(env({ POSTGRES_SSL: 'false', POSTGRES_SSL_CA: '/ca.pem' }), readFile)).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('Escenario 2: POSTGRES_SSL=true sin CA verifica con las autoridades del sistema, sin propiedad ca', () => {
    const readFile = jest.fn();
    const result = buildPostgresSsl(env({ POSTGRES_SSL: 'true' }), readFile);
    expect(result).toStrictEqual({ rejectUnauthorized: true });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('Escenario 2: POSTGRES_SSL_CA vacía se trata como no definida (D1)', () => {
    const readFile = jest.fn();
    const result = buildPostgresSsl(env({ POSTGRES_SSL: 'true', POSTGRES_SSL_CA: '' }), readFile);
    expect(result).toStrictEqual({ rejectUnauthorized: true });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('Escenario 3: con CA propia lee esa ruta una sola vez y verifica con ella', () => {
    const readFile = jest.fn().mockReturnValue('-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----');
    const result = buildPostgresSsl(env({ POSTGRES_SSL: 'true', POSTGRES_SSL_CA: '/etc/ssl/render-ca.pem' }), readFile);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith('/etc/ssl/render-ca.pem');
    expect(result).toStrictEqual({
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
    });
  });

  it('Escenario 4: CA inexistente lanza un error que nombra POSTGRES_SSL_CA y no filtra secretos', () => {
    const readFile = jest.fn().mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, open '/no/existe.pem' contenido-sensible-del-archivo");
    });
    const get = env({
      POSTGRES_SSL: 'true',
      POSTGRES_SSL_CA: '/no/existe.pem',
      POSTGRES_PASSWORD: 'clave-secreta-123',
    });

    let caught: Error | undefined;
    try {
      buildPostgresSsl(get, readFile);
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain('POSTGRES_SSL_CA');
    expect(caught?.message).not.toContain('contenido-sensible-del-archivo');
    expect(caught?.message).not.toContain('clave-secreta-123');
    expect(caught?.message).not.toContain('/no/existe.pem');
  });

  it.each(['yes', 'TRUE', '1', 'on'])('Escenario 5: POSTGRES_SSL=%s impide el arranque con el mensaje exacto', (value) => {
    const readFile = jest.fn();
    expect(() => buildPostgresSsl(env({ POSTGRES_SSL: value, POSTGRES_SSL_CA: '/ca.pem' }), readFile)).toThrow(
      new Error('POSTGRES_SSL debe ser true o false'),
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it('D1: POSTGRES_SSL vacía equivale a false', () => {
    expect(buildPostgresSsl(env({ POSTGRES_SSL: '' }), jest.fn())).toBe(false);
  });
});
