import { DEFAULT_VERIFY_EMAIL_PATH } from './constants';
import { buildVerificationLink } from './iam.utils';

describe('buildVerificationLink (enlace del correo de verificación)', () => {
  it('por defecto apunta a la página web /verificar-correo (SESSION_LOG 2026-09-29) y no a /verify-email', () => {
    expect(DEFAULT_VERIFY_EMAIL_PATH).toBe('/verificar-correo');
    const link = buildVerificationLink('http://localhost:3000', DEFAULT_VERIFY_EMAIL_PATH, 'abc');
    expect(link).toBe('http://localhost:3000/verificar-correo?token=abc');
    expect(link).not.toContain('/verify-email');
  });

  it('normaliza la barra final de APP_URL y la barra inicial de la ruta', () => {
    expect(buildVerificationLink('https://nexus.example.com/', '/verificar-correo', 't')).toBe(
      'https://nexus.example.com/verificar-correo?token=t',
    );
    expect(buildVerificationLink('https://nexus.example.com///', 'verificar-correo', 't')).toBe(
      'https://nexus.example.com/verificar-correo?token=t',
    );
  });

  it('respeta una ruta distinta (IAM_VERIFY_EMAIL_PATH) y un APP_URL con subdirectorio', () => {
    expect(buildVerificationLink('https://host.example/app', '/auth/verificar', 't')).toBe(
      'https://host.example/app/auth/verificar?token=t',
    );
  });

  it('el token viaja intacto: un token base64url no se altera y uno con caracteres especiales se codifica', () => {
    const base64url = 'Ab3_-xYz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    expect(buildVerificationLink('http://x', '/v', base64url)).toBe(`http://x/v?token=${base64url}`);

    const raro = 'a+b/c=d e&f';
    const link = buildVerificationLink('http://x', '/v', raro);
    expect(link).not.toContain(' ');
    expect(link).not.toContain('&f');
    expect(new URL(link).searchParams.get('token')).toBe(raro); // se recupera exactamente
  });
});
