import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { FilesService } from './files.service';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class TrashRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrashRetentionService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopping = false;

  constructor(private readonly files: FilesService) {}

  onModuleInit(): void {
    const configured = Number(process.env.TRASH_PURGE_INTERVAL_MS);
    const interval = Number.isInteger(configured) && configured > 0 && configured <= 2_147_483_647
      ? configured
      : DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => void this.run(), interval).unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    await this.running;
  }

  run(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    this.running ??= this.purgeExpired()
      .catch(() => this.logger.error('No se pudo consultar la papelera vencida; se reintentará en el próximo ciclo.'))
      .finally(() => { this.running = undefined; });
    return this.running;
  }

  private async purgeExpired(): Promise<void> {
    for (const kind of ['folder', 'file'] as const) {
      let after: string | null = null;
      while (!this.stopping) {
        const candidates = await this.files.listExpiredTrash(kind, after);
        if (!candidates.length) break;
        for (const item of candidates) {
          if (this.stopping) return;
          try {
            if (kind === 'folder') await this.files.purgeExpiredFolder(item.id, item.organizationId);
            else await this.files.purgeExpiredFile(item.id, item.organizationId);
          } catch {
            this.logger.error(`No se completó la purga de ${kind} ${item.id}; se revisará en el próximo ciclo.`);
          }
        }
        after = candidates[candidates.length - 1].id;
      }
    }
  }
}
