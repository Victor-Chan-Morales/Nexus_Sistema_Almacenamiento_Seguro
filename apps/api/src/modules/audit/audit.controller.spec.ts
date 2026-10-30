import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { ListAuditEventsQueryDto } from './dto/list-audit-events.dto';

describe('AuditController (SPEC-402)', () => {
  let controller: AuditController;
  let service: AuditService;
  let reflector: Reflector;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditController],
      providers: [
        {
          provide: AuditService,
          useValue: {
            listEvents: jest
              .fn()
              .mockResolvedValue({ events: [], nextBefore: null }),
          },
        },
        Reflector,
      ],
    }).compile();

    controller = module.get<AuditController>(AuditController);
    service = module.get<AuditService>(AuditService);
    reflector = module.get<Reflector>(Reflector);
  });

  it('Escenario 5: El endpoint getEvents está restringido exclusivamente a TENANT_ADMIN', () => {
    const roles = reflector.get<Role[]>(ROLES_KEY, controller.getEvents);
    expect(roles).toBeDefined();
    expect(roles).toEqual([Role.TENANT_ADMIN]);
  });

  it('Delega la consulta al servicio con el organizationId de la sesión', async () => {
    const req = {
      user: {
        userId: 'usr-123',
        organizationId: 'org-456',
        role: 'tenant_admin',
      },
    };
    const query = { limit: 50 };

    await controller.getEvents(req, query);

    expect(service.listEvents).toHaveBeenCalledWith('org-456', query);
  });

  it('Lanza ForbiddenException si la sesión no contiene un organizationId', async () => {
    const req = { user: { userId: 'usr-123' } };
    await expect(controller.getEvents(req, { limit: 50 })).rejects.toThrow(
      ForbiddenException,
    );
  });

  describe('Escenario 3: Validación de límites en query DTO', () => {
    it('valida que limit por defecto sea 50 y acepte valores entre 1 y 100 con fecha ISO', async () => {
      const dto = plainToInstance(ListAuditEventsQueryDto, {
        limit: '50',
        before: '2026-10-30T10:00:00.000Z',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.limit).toBe(50);
    });

    it('falla validación si limit es menor a 1, mayor a 100 o before no es ISO', async () => {
      const dto = plainToInstance(ListAuditEventsQueryDto, {
        limit: 150,
        before: 'fecha-invalida',
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThanOrEqual(2);
      const propertyNames = errors.map((e) => e.property);
      expect(propertyNames).toContain('limit');
      expect(propertyNames).toContain('before');
    });
  });
});