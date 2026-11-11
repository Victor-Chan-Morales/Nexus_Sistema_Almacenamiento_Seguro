import { GmailTransportError } from '../modules/iam/infrastructure/gmail-transport';
import { runMailCheck } from './mail-check';

const env = {
  MAIL_TRANSPORT: 'gmail-api', GMAIL_SENDER: 'nexus@gmail.com', GMAIL_CLIENT_ID: 'client-fixture',
  GMAIL_CLIENT_SECRET: 'secret-fixture', GMAIL_REFRESH_TOKEN: 'refresh-fixture',
};
const args = ['--to', 'destino@example.com'];

function fixture() {
  const transport = {
    sendMail: jest.fn().mockResolvedValue({ messageId: 'gmail-id-fixture' }),
  };
  return { transport, output: { log: jest.fn(), error: jest.fn() }, factory: jest.fn().mockReturnValue(transport) };
}

describe('mail:check', () => {
  it('envía al buzón solicitado y muestra el identificador aceptado por Gmail', async () => {
    const { transport, output, factory } = fixture();
    await expect(runMailCheck(args, env, output, factory)).resolves.toBe(0);
    expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: args[1] }));
    expect(output.log).toHaveBeenCalledWith(expect.stringContaining('gmail-id-fixture'));
  });

  it('si falla la autenticación devuelve 2 y oculta los detalles', async () => {
    const { transport, output, factory } = fixture();
    const error = new GmailTransportError('GMAIL_AUTH_FAILED');
    error.message = env.GMAIL_REFRESH_TOKEN;
    transport.sendMail.mockRejectedValue(error);
    await expect(runMailCheck(args, env, output, factory)).resolves.toBe(2);
    expect(output.log).not.toHaveBeenCalled();
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('GMAIL_AUTH_FAILED'));
    expect(JSON.stringify(output.error.mock.calls)).not.toContain(env.GMAIL_REFRESH_TOKEN);
  });

  it('rechaza la configuración local sin abrir el transporte', async () => {
    const { output, factory } = fixture();
    await expect(runMailCheck(args, { ...env, MAIL_TRANSPORT: 'smtp' }, output, factory)).resolves.toBe(2);
    expect(factory).not.toHaveBeenCalled();
  });
});
