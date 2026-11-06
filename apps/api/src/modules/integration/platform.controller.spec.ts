import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SuperAdminGuard } from '../iam/guards/super-admin.guard';
import { DEFAULT_PAGE_SIZE, PlatformController, PlatformOrganizationsQuery } from './platform.controller';

describe('PlatformController (SPEC-501)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const parse = (query: Record<string, unknown>) =>
    pipe.transform(query, { type: 'query', metatype: PlatformOrganizationsQuery }) as Promise<PlatformOrganizationsQuery>;

  it('Escenario 5: la clase exige sesión JWT y SuperAdminGuard, en ese orden', () => {
    const guards = Reflect.getMetadata('__guards__', PlatformController) as unknown[];
    expect(guards).toHaveLength(2);
    expect(guards[1]).toBe(SuperAdminGuard);
  });

  it('GET /platform/organizations usa los valores por defecto cuando no hay limit ni offset', async () => {
    const platform = { listOrganizations: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const controller = new PlatformController(platform as never);
    await controller.listOrganizations(await parse({}));
    expect(platform.listOrganizations).toHaveBeenCalledWith(DEFAULT_PAGE_SIZE, 0);
  });

  it('convierte limit y offset de texto a número y los pasa al servicio', async () => {
    const platform = { listOrganizations: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const controller = new PlatformController(platform as never);
    await controller.listOrganizations(await parse({ limit: '50', offset: '10' }));
    expect(platform.listOrganizations).toHaveBeenCalledWith(50, 10);
  });

  it.each([{ limit: '0' }, { limit: '101' }, { limit: 'abc' }, { offset: '-1' }, { offset: '1.5' }])(
    'rechaza parámetros fuera de rango: %j',
    async (query) => {
      await expect(parse(query)).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('Escenario 6 / aislamiento: rechaza cualquier parámetro de organización o rol (forbidNonWhitelisted)', async () => {
    await expect(parse({ organizationId: 'o9' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(parse({ isSuperAdmin: 'true' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('GET /platform/metrics delega en el servicio sin parámetros', async () => {
    const metrics = { organizations: { active: 1, suspended: 0, cancelled: 0 }, activeUsers: 1, usedBytes: 0, subscriptionsByPlan: [] };
    const platform = { getMetrics: jest.fn().mockResolvedValue(metrics) };
    expect(await new PlatformController(platform as never).getMetrics()).toBe(metrics);
    expect(PlatformController.prototype.getMetrics.length).toBe(0);
  });
});
