/**
 * Puerto de Dominio (Hexagonal / Clean Architecture)
 *
 * Define el contrato que necesita Billing para consultar el uso de almacenamiento
 * sin acoplarse ni depender directamente del módulo Files.
 */
export interface StorageUsagePort {
  /**
   * Obtiene la cantidad de bytes confirmados y almacenados por una organización.
   * @param organizationId Identificador UUID de la organización
   */
  getUsedStorageBytes(organizationId: string): Promise<bigint>;
}

export const STORAGE_USAGE_PORT = Symbol('STORAGE_USAGE_PORT');
