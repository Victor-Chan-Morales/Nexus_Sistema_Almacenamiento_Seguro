import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Destination } from '../files/entities/destination.entity';
import { ObjectStorage } from './object-storage';
import { StorageService } from './storage.service';

/**
 * StorageRouter — elige el almacén de cada operación según el destino (SPEC-801).
 *
 * FilesService pide un ObjectStorage por destination_id y no conoce el proveedor.
 * Lectura y borrado admiten destinos deshabilitados; escritura exige uno habilitado.
 * Un destino de otra organización (o inexistente) responde 404 antes de tocar el almacén.
 */
@Injectable()
export class StorageRouter {
  constructor(
    @InjectRepository(Destination)
    private readonly destinations: Repository<Destination>,
    private readonly environmentStorage: StorageService,
  ) {}

  /** Bucket del destino de entorno. Lo usa FilesService al crear el destino predeterminado. */
  get defaultBucketName(): string {
    return this.environmentStorage.bucketName;
  }

  /** Almacén para leer o borrar objetos de un destino, esté habilitado o no. */
  async forRead(organizationId: string, destinationId: string): Promise<ObjectStorage> {
    await this.findDestination(organizationId, destinationId);
    return this.providerFor();
  }

  /** Almacén para escribir: el destino debe estar habilitado. */
  async forWrite(organizationId: string, destinationId: string): Promise<ObjectStorage> {
    const destination = await this.findDestination(organizationId, destinationId);
    if (!destination.isEnabled) {
      throw new ConflictException('El destino de almacenamiento está deshabilitado');
    }
    return this.providerFor();
  }

  private async findDestination(organizationId: string, destinationId: string): Promise<Destination> {
    const destination = await this.destinations.findOne({
      where: { id: destinationId, organizationId },
    });
    if (!destination) {
      throw new NotFoundException('Destino de almacenamiento no encontrado');
    }
    return destination;
  }

  /**
   * SPEC-801: todo destino usa la configuración S3_* de entorno, cuyas credenciales son
   * referencias `environment:*`. SPEC-802 ramificará aquí según connection_details_encrypted.
   */
  private providerFor(): ObjectStorage {
    return this.environmentStorage;
  }
}
