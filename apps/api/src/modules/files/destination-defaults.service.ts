import { Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { Destination } from './entities/destination.entity';
import { Folder } from './entities/folder.entity';
import { destinationNotAvailableError } from './destination-errors';

/**
 * Consultas y cambio del destino predeterminado de una organización (SPEC-803).
 * Todos los métodos reciben el `EntityManager` del llamador: el cambio debe ocurrir dentro de su transacción.
 */
@Injectable()
export class DestinationDefaults {
  /** Destinos que pueden recibir escrituras: habilitados y "Conectado". Orden estable por antigüedad. */
  listAvailable(manager: EntityManager, organizationId: string): Promise<Destination[]> {
    return manager.find(Destination, {
      where: { organizationId, isEnabled: true, connectionStatus: 'Conectado' },
      order: { createdAt: 'ASC' },
    });
  }

  getDefault(manager: EntityManager, organizationId: string): Promise<Destination | null> {
    return manager.findOne(Destination, { where: { organizationId, isDefault: true } });
  }

  /**
   * Marca `destinationId` como predeterminado. El índice único parcial `uq_destination_one_default_per_organization`
   * no es diferible, así que primero se quita la marca al anterior y después se pone al nuevo.
   * Las raíces de todos los Drives (personales y de equipo) pasan al nuevo destino; versiones y subcarpetas no cambian.
   */
  async promoteToDefault(manager: EntityManager, organizationId: string, destinationId: string): Promise<void> {
    const target = await manager.findOne(Destination, {
      where: { id: destinationId, organizationId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!target || !target.isEnabled || target.connectionStatus !== 'Conectado') {
      throw destinationNotAvailableError();
    }

    await manager.update(Destination, { organizationId, isDefault: true }, { isDefault: false });
    await manager.update(Destination, { id: destinationId, organizationId }, { isDefault: true });
    await manager.update(Folder, { organizationId, parentId: IsNull() }, { destinationId });
  }
}
