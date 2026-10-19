import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TransactionContext, UnitOfWork } from '../ports/transaction';

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }
}
