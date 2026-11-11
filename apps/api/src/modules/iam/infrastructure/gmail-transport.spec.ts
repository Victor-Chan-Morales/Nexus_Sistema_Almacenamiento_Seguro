import { createGmailTransport } from './gmail-transport';

const config = {
  GMAIL_SENDER: 'nexus@gmail.com', GMAIL_CLIENT_ID: 'client-fixture',
  GMAIL_CLIENT_SECRET: 'secret-fixture', GMAIL_REFRESH_TOKEN: 'refresh-fixture',
};
const message = { to: 'buzon@example.com', subject: 'Verifica Nexus', text: 'Verifica la cuenta', html: '<p>Verifica la cuenta</p>' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = (value = 'access-fixture') => reply({ access_token: value, expires_in: 3600 });

describe('Transporte HTTPS de Gmail', () => {
  it('comparte la renovación simultánea y envía MIME por HTTPS desde el remitente configurado', async () => {
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(token())
      .mockImplementation(async () => reply({ id: 'gmail-id' }));
    const transport = createGmailTransport(config, request);
    await expect(Promise.all([transport.sendMail(message), transport.sendMail(message)])).resolves.toEqual([
      { messageId: 'gmail-id' }, { messageId: 'gmail-id' },
    ]);
    await transport.sendMail(message);
    expect(request).toHaveBeenCalledTimes(4);
    const [tokenUrl, tokenRequest] = request.mock.calls[0];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    expect(new URLSearchParams(tokenRequest.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
    expect(new URLSearchParams(tokenRequest.body as URLSearchParams).get('refresh_token')).toBe(config.GMAIL_REFRESH_TOKEN);

    const [sendUrl, sendRequest] = request.mock.calls[1];
    expect(sendUrl).toBe('https://gmail.googleapis.com/gmail/v1/users/nexus%40gmail.com/messages/send');
    expect(sendRequest).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer access-fixture' } });
    expect(sendRequest.signal).toBeInstanceOf(AbortSignal);
    const { raw } = JSON.parse(sendRequest.body as string) as { raw: string };
    expect(raw).toMatch(/^[a-zA-Z0-9_-]+$/);
    const mime = Buffer.from(raw, 'base64url').toString();
    expect(mime).toContain('From: Nexus <nexus@gmail.com>');
    expect(mime).toContain('To: buzon@example.com');
    expect(mime).toContain('Subject: Verifica Nexus');
    expect(mime).toContain('Content-Type: multipart/alternative');
    expect(mime).toContain('<p>Verifica la cuenta</p>');
  });

  it('renueva un token rechazado en el siguiente intento sin repetir el envío en la misma llamada', async () => {
    const request = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(token('old'))
      .mockResolvedValueOnce(reply({}, 401))
      .mockResolvedValueOnce(token('new'))
      .mockResolvedValueOnce(reply({ id: 'accepted' }));
    const transport = createGmailTransport(config, request);
    await expect(transport.sendMail(message)).rejects.toMatchObject({ name: 'GMAIL_AUTH_FAILED' });
    expect(request).toHaveBeenCalledTimes(2);
    await expect(transport.sendMail(message)).resolves.toEqual({ messageId: 'accepted' });
    expect(request.mock.calls[3][1].headers).toMatchObject({ Authorization: 'Bearer new' });
  });

  it('no envía si Google revoca la autorización y no devuelve detalles del proveedor', async () => {
    const request = jest.fn().mockResolvedValue(reply({ error: 'invalid_grant', error_description: config.GMAIL_REFRESH_TOKEN }, 400));
    await expect(createGmailTransport(config, request).sendMail(message)).rejects.toThrow('GMAIL_AUTH_FAILED');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, {}, 'GMAIL_RATE_LIMITED'],
    [403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 'GMAIL_RATE_LIMITED'],
    [503, {}, 'GMAIL_UNAVAILABLE'],
    [200, { id: 'valor no válido' }, 'GMAIL_SEND_FAILED'],
  ])('clasifica una respuesta %s sin confirmar el envío', async (status, body, error) => {
    const request = jest.fn().mockResolvedValueOnce(token()).mockResolvedValueOnce(reply(body, status));
    await expect(createGmailTransport(config, request).sendMail(message)).rejects.toMatchObject({ name: error });
  });

  it('clasifica un fallo HTTPS sin exponer su causa', async () => {
    const request = jest.fn().mockResolvedValueOnce(token()).mockRejectedValueOnce(new Error('detalle privado de TLS'));
    await expect(createGmailTransport(config, request).sendMail(message)).rejects.toThrow('GMAIL_UNAVAILABLE');
  });
});
