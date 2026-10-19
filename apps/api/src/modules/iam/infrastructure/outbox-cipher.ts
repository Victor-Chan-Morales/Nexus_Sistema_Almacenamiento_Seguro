import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Cifra el token de verificación que espera en la outbox (AES-256-GCM). La clave sale de JWT_SECRET:
 * si el secreto cambia, los mensajes pendientes no se pueden descifrar y vencen sin enviarse.
 */
@Injectable()
export class OutboxCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = createHash('sha256').update(`email-outbox:${config.getOrThrow<string>('JWT_SECRET')}`).digest();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join('.');
  }

  decrypt(payload: string): string {
    const [iv, tag, data] = payload.split('.').map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }
}
