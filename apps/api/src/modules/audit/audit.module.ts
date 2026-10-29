import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditEvent } from './entities/audit-event.entity';

/**
 * Módulo AUDIT
 *
 * Servicio base de auditoría (SPEC-401). Global para que IAM, Files y Billing inyecten
 * AuditService sin importarlo. No importa módulos de dominio: no hay dependencia circular.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
