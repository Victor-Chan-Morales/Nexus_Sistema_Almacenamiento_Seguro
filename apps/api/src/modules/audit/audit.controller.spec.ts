import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../iam/decorators/roles.decorator';
import { Role } from '../iam/domain/enums';
import { RolesGuard } from '../iam/guards/roles.guard';
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

  /** Contexto HTTP mínimo para ejecutar el RolesGuard real sobre getEvents con el rol indicado. */
  const contextFor = (role: Role): ExecutionContext =>
    ({
      getHandler: () => controller.getEvents,
      getClass: () => AuditController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { userId: 'usr-123', organizationId: 'org-456', role },
        }),
      }),
    }) as unknown as ExecutionContext;

  const guardErrorFor = (role: Role): ForbiddenException => {
    const guard = new RolesGuard(reflector);
    try {
      guard.canActivate(contextFor(role));
    } catch (error) {
      return error as ForbiddenException;
    }
    throw new Error('RolesGuard no lanzó error');
  };

  it('Escenario 5: El endpoint getEvents está restringido exclusivamente a TENANT_ADMIN', () => {
    const roles = reflector.get<Role[]>(ROLES_KEY, controller.getEvents);
    expect(roles).toBeDefined();
    expect(roles).toEqual([Role.TENANT_ADMIN]);
  });

  it('Escenario 5: un colaborador recibe 403 con código FORBIDDEN_ROLE', () => {
    const error = guardErrorFor(Role.COLABORADOR);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toEqual(expect.objectContaining({ code: 'FORBIDDEN_ROLE' }));
  });

  it('Escenario 5: un tenant_admin supera el RolesGuard', () => {
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(contextFor(Role.TENANT_ADMIN))).toBe(true);
  });

  it('Delega la consulta al servicio con el organizationId de la sesión', async () => {
    const req = {
      user: {
        userId: 'usr-123',
        organizationId: 'org-456',
        role: Role.TENANT_ADMIN,
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
    it('usa 50 como limit por defecto cuando el parámetro no se envía', async () => {
      const dto = plainToInstance(ListAuditEventsQueryDto, {});

      expect(await validate(dto)).toHaveLength(0);
      expect(dto.limit).toBe(50);
    });

    it.each([1, 100])('acepta limit = %i', async (limit) => {
      const dto = plainToInstance(ListAuditEventsQueryDto, { limit: String(limit) });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto.limit).toBe(limit);
    });

    it.each([0, 101])('rechaza limit = %i', async (limit) => {
      const dto = plainToInstance(ListAuditEventsQueryDto, { limit });
      const errors = await validate(dto);

      expect(errors.map((e) => e.property)).toContain('limit');
    });

    it('rechaza before que no es ISO-8601', async () => {
      const dto = plainToInstance(ListAuditEventsQueryDto, { before: 'fecha-invalida' });
      const errors = await validate(dto);

      expect(errors.map((e) => e.property)).toContain('before');
    });

    it('acepta before ISO-8601', async () => {
      const dto = plainToInstance(ListAuditEventsQueryDto, {
        before: '2026-10-30T10:00:00.000Z',
      });

      expect(await validate(dto)).toHaveLength(0);
    });
  });
});
