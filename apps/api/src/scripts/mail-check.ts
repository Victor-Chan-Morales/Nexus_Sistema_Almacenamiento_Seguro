import { ConfigModule } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { GmailTransportError } from '../modules/iam/infrastructure/gmail-transport';
import { assertMailConfig, MailConfig } from '../modules/iam/infrastructure/mail-config';
import { createMailTransport } from '../modules/iam/infrastructure/mail-transport';

export async function runMailCheck(
  args: string[],
  env: MailConfig,
  output: Pick<Console, 'log' | 'error'> = console,
  createTransport = createMailTransport,
): Promise<number> {
  const [option, recipient] = args;
  if (args.length !== 2 || option !== '--to' || !recipient || !isEmail(recipient)) {
    output.error('Uso: npm run mail:check -- --to <buzón real>');
    return 2;
  }

  const config = { ...env, NODE_ENV: 'production' };
  try {
    assertMailConfig(config);
  } catch (error) {
    output.error((error as Error).message);
    return 2;
  }

  try {
    const transport = createTransport(config);
    const sent = await transport.sendMail({
      to: recipient,
      subject: 'Prueba de correo de Nexus',
      text: 'Nexus envió este mensaje para comprobar la entrega de correo.',
    });
    output.log(`Gmail aceptó el correo. ID: ${sent.messageId}`);
    output.log('Revisa Authentication-Results en el buzón que recibió el mensaje.');
    return 0;
  } catch (error) {
    const code = error instanceof GmailTransportError ? error.code : 'GMAIL_SEND_FAILED';
    output.error(code === 'GMAIL_AUTH_FAILED'
      ? `${code}: revisa la cuenta remitente y su autorización OAuth en Google Cloud.`
      : `${code}: Gmail no confirmó el envío.`);
    return 2;
  }
}

if (require.main === module) {
  void ConfigModule.forRoot({ envFilePath: ['.env', '../../.env'] })
    .then(() => runMailCheck(process.argv.slice(2), process.env))
    .then((code) => { process.exitCode = code; })
    .catch(() => {
      console.error('No se pudo ejecutar la comprobación de correo.');
      process.exitCode = 2;
    });
}
