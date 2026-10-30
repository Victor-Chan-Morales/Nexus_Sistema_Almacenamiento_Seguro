import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ROLES_KEY } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { ForbiddenException } from '@nestjs/common';

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
              .mockResolvedValue({ items: [], nextBefore: null }),
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
});