import { resolveApiPort } from './api-port';

const env = (vars: Record<string, string | undefined>) => (key: string) => vars[key];

describe('resolveApiPort (SPEC-807)', () => {
  it('Escenario 6: sin API_PORT usa PORT asignado por la plataforma', () => {
    expect(resolveApiPort(env({ PORT: '10000' }))).toBe(10000);
  });

  it('Escenario 7: API_PORT tiene prioridad sobre PORT', () => {
    expect(resolveApiPort(env({ API_PORT: '3001', PORT: '10000' }))).toBe(3001);
  });

  it('Escenario 8: sin API_PORT ni PORT escucha en 3001', () => {
    expect(resolveApiPort(env({}))).toBe(3001);
  });

  it('Escenario 9: PORT inválido impide el arranque con el mensaje exacto', () => {
    expect(() => resolveApiPort(env({ PORT: 'abc' }))).toThrow(
      new Error('El puerto debe ser un número entre 1 y 65535'),
    );
  });

  it('API_PORT vacía se trata como no definida y usa PORT', () => {
    expect(resolveApiPort(env({ API_PORT: '', PORT: '10000' }))).toBe(10000);
  });

  it('API_PORT inválida falla y no cae silenciosamente a PORT', () => {
    expect(() => resolveApiPort(env({ API_PORT: 'abc', PORT: '10000' }))).toThrow(
      new Error('El puerto debe ser un número entre 1 y 65535'),
    );
  });

  it.each(['0', '65536', '3001abc', '1e3', '-1', '3.5'])('rechaza el valor %s', (value) => {
    expect(() => resolveApiPort(env({ API_PORT: value }))).toThrow(
      new Error('El puerto debe ser un número entre 1 y 65535'),
    );
  });

  it('acepta los límites 1 y 65535', () => {
    expect(resolveApiPort(env({ API_PORT: '1' }))).toBe(1);
    expect(resolveApiPort(env({ API_PORT: '65535' }))).toBe(65535);
  });

  it('ignora espacios alrededor del valor de PORT', () => {
    expect(resolveApiPort(env({ PORT: ' 10000 ' }))).toBe(10000);
  });
});
