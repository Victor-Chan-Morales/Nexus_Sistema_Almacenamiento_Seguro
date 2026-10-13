import type { EntityManager } from 'typeorm';

/**
 * Contexto de una transacción abierta. Alias del EntityManager de TypeORM:
 * si cambia el ORM, solo cambian este alias y las clases de infrastructure/.
 */
export type TransactionContext = EntityManager;

export abstract class UnitOfWork {
  abstract run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
