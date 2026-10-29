import { errorCode } from './audit-error-code';

describe('errorCode', () => {
  it('devuelve el código de Postgres y de Node tal cual', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: '23503' }))).toBe('23503');
    expect(errorCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED');
  });

  it('no guarda códigos demasiado largos ni con caracteres libres', () => {
    expect(errorCode({ code: 'X'.repeat(101) })).toBe('UNKNOWN');
    expect(errorCode({ code: 'relation "audit.x" does not exist' })).toBe('UNKNOWN');
  });

  it('no guarda códigos que no son cadenas ni están en mayúsculas', () => {
    expect(errorCode({ code: 23503 })).toBe('UNKNOWN');
    expect(errorCode({ code: { toString: () => 'OBJ' } })).toBe('UNKNOWN');
    expect(errorCode({ code: 'econnrefused' })).toBe('UNKNOWN');
  });

  it('acepta cualquier valor lanzado', () => {
    expect(errorCode(null)).toBe('UNKNOWN');
    expect(errorCode(undefined)).toBe('UNKNOWN');
    expect(errorCode('texto')).toBe('UNKNOWN');
  });
});
