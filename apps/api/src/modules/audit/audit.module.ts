import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditChainWriter } from './audit-chain-writer';
import { AuditController } from './audit.controller';
import { AuditOutboxService } from './audit-outbox.service';
import { AuditService } from './audit.service';
import { AuditEvent } from './entities/audit-event.entity';
import { AuditOutbox } from './entities/audit-outbox.entity';

/**
 * Módulo AUDIT
 *
 * Servicio base de auditoría (SPEC-401) con su outbox de reintento (issue #17). Global para que IAM, Files y
 * Billing inyecten AuditService sin importarlo. No importa módulos de dominio: no hay dependencia circular.
 * Expone AuditController para consulta de bitácora (SPEC-402).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent, AuditOutbox])],
  controllers: [AuditController],
  providers: [AuditChainWriter, AuditOutboxService, AuditService],
  exports: [AuditService, AuditOutboxService],
})
export class AuditModule {}
