import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { StorageUsagePort } from '../ports/storage-usage.port';

/**
 * Adaptador de Infraestructura para StorageUsagePort
 *
 * Implementa la inversión de dependencias: resuelve en tiempo de ejecución
 * el servicio de almacenamiento (FilesService) a través de ModuleRef sin
 * crear dependencias circulares estáticas ni acoplamiento directo entre módulos.
 */
@Injectable()
export class ModuleRefStorageUsageAdapter implements StorageUsagePort {
  private readonly logger = new Logger(ModuleRefStorageUsageAdapter.name);

  constructor(private readonly moduleRef: ModuleRef) {}

  async getUsedStorageBytes(organizationId: string): Promise<bigint> {
    try {
      // Búsqueda dinámica en el contenedor IoC de NestJS
      const filesService = this.moduleRef.get<any>('FilesService', { strict: false });
      if (filesService && typeof filesService.getUsedStorageBytes === 'function') {
        return await filesService.getUsedStorageBytes(organizationId);
      }
    } catch (error: any) {
      this.logger.warn(
        `No fue posible consultar el uso de almacenamiento para org ${organizationId}: ${error?.message}`,
      );
    }
    return BigInt(0);
  }
}
