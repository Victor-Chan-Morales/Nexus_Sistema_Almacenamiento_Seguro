import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { EmailService } from './email.service';
import { assertMailConfig, MailConfig } from './mail-config';

const config: MailConfig = {
  NODE_ENV: 'production', MAIL_TRANSPORT: 'gmail-api', GMAIL_SENDER: 'nexus@gmail.com',
  GMAIL_CLIENT_ID: 'client-fixture', GMAIL_CLIENT_SECRET: 'secret-fixture', GMAIL_REFRESH_TOKEN: 'refresh-fixture',
};

const serviceConfig = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as ConfigService;

describe('configuración de correo', () => {
  it.each([
    ['MAIL_TRANSPORT', 'smtp'], ['MAIL_TRANSPORT', undefined], ['GMAIL_SENDER', 'otro@example.com'],
    ['GMAIL_SENDER', 'Nexus <nexus@gmail.com>'], ['GMAIL_CLIENT_ID', undefined],
    ['GMAIL_CLIENT_SECRET', ' '], ['GMAIL_REFRESH_TOKEN', undefined],
  ])('en producción rechaza %s con valor %s', (key, value) => {
    expect(() => assertMailConfig({ ...config, [key]: value })).toThrow(new Error(`MAIL_CONFIG_INVALID: revisa ${key}`));
  });

  it('acepta Gmail API en producción y Mailpit sin OAuth en desarrollo', () => {
    expect(() => assertMailConfig(config)).not.toThrow();
    expect(() => assertMailConfig({ MAIL_HOST: 'localhost' })).not.toThrow();
  });

  it('aplica la guarda en el constructor del servicio de correo', () => {
    expect(() => new EmailService(serviceConfig({ ...config, GMAIL_SENDER: 'otro@example.com' })))
      .toThrow(new Error('MAIL_CONFIG_INVALID: revisa GMAIL_SENDER'));
  });

  it('registra el resultado sin el token, enlace ni credenciales', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const service = new EmailService(serviceConfig({ ...config, WEB_URL: 'https://nexus.example.com' }));
    const send = jest.spyOn(service['transporter'], 'sendMail').mockResolvedValue({ messageId: 'fixture' });
    try {
      await service.sendVerification('destino@example.com', 'Prueba', 'token-fixture');
      expect(send).toHaveBeenCalledTimes(1);
      expect(log.mock.calls).toEqual([['Correo de verificación enviado']]);
    } finally {
      log.mockRestore();
    }
  });
});
