import {
  Body, Controller, Get, Header, HttpCode, HttpException, OnModuleDestroy,
  Param, Post, Req, StreamableFile, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { isIP } from 'node:net';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditActorType, AuditResource, AuditResult } from '../audit/audit.types';
import { PasswordHasher } from '../iam/ports/security';
import { ShareLink } from './entities/share-link.entity';
import { FileVersionsService } from './file-versions.service';
import { ShareLinksService } from './share-links.service';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function visitorIp(request: Request) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = request.get('x-forwarded-for')?.split(',').at(-1)?.trim();
    if (forwarded && isIP(forwarded)) return forwarded;
  }
  return request.socket.remoteAddress ?? 'unknown';
}

@Controller('public/share-links')
export class PublicShareLinksController implements OnModuleDestroy {
  private readonly attempts = new Map<string, { failures: number[]; pending: number }>();
  private readonly cleanup = setInterval(() => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [key, entry] of this.attempts) {
      if (!entry.pending && !entry.failures.some((time) => time > cutoff)) this.attempts.delete(key);
    }
  }, WINDOW_MS).unref();

  constructor(
    private readonly links: ShareLinksService,
    private readonly versions: FileVersionsService,
    private readonly hasher: PasswordHasher,
    private readonly audit: AuditService,
  ) {}

  onModuleDestroy() {
    clearInterval(this.cleanup);
  }

  @Get(':token')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  async metadata(@Param('token') token: string) {
    const { link, file, version } = await this.links.resolvePublicLink(token);
    const expiresAt = link.expiresAt.toISOString();
    if (link.passwordHash) return { requiresPassword: true, expiresAt };
    return {
      requiresPassword: false,
      expiresAt,
      name: file.name,
      sizeBytes: Number(version.sizeBytes),
      mimeType: file.mimeType || 'application/octet-stream',
    };
  }

  @Post(':token/download')
  @HttpCode(200)
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'no-store')
  async download(@Param('token') token: string, @Body('password') password: unknown, @Req() request: Request) {
    const { link, file, version } = await this.links.resolvePublicLink(token);
    if (link.passwordHash) await this.checkPassword(link, link.passwordHash, password, visitorIp(request));

    const bytes = await this.versions.readVersionBytes(link.organizationId, file, version);
    const name = encodeURIComponent(file.name.replace(/[/\\]/g, '_'))
      .replace(/['()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());
    await this.recordAccess(link, AuditResult.SUCCESS);
    return new StreamableFile(bytes, {
      type: 'application/octet-stream',
      disposition: `attachment; filename="archivo"; filename*=UTF-8''${name}`,
    });
  }

  private async checkPassword(link: ShareLink, hash: string, password: unknown, ip: string) {
    const key = `${link.id}:${ip}`;
    const entry = this.attempts.get(key) ?? { failures: [], pending: 0 };
    const cutoff = Date.now() - WINDOW_MS;
    entry.failures = entry.failures.filter((time) => time > cutoff);
    // Reserva un intento antes de Argon2 para que solicitudes simultáneas no eludan el límite.
    if (entry.failures.length + entry.pending >= MAX_FAILURES) {
      throw new HttpException({ code: 'TOO_MANY_ATTEMPTS', message: 'Demasiados intentos. Inténtalo más tarde.' }, 429);
    }
    this.attempts.set(key, entry);
    entry.pending++;
    let valid: boolean;
    try {
      valid = typeof password === 'string' && password.length > 0 && password.length <= 128
        && await this.hasher.verify(hash, password);
      if (!valid) entry.failures.push(Date.now());
    } finally {
      entry.pending--;
      if (!entry.pending && !entry.failures.length) this.attempts.delete(key);
    }
    if (valid) return;
    await this.recordAccess(link, AuditResult.FAILURE);
    throw new UnauthorizedException({
      code: 'SHARE_LINK_PASSWORD_INVALID',
      message: 'La contraseña del enlace no es válida.',
    });
  }

  private async recordAccess(link: ShareLink, result: AuditResult) {
    await this.audit.logEvent({
      organizationId: link.organizationId,
      actorType: AuditActorType.VISITOR,
      action: AuditAction.SHARE_LINK_ACCESSED,
      resourceType: AuditResource.SHARE_LINK,
      resourceId: link.id,
      result,
    }).catch(() => {});
  }
}
