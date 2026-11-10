import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { BillingService } from '../src/modules/billing/billing.service';
import { DeploymentModel, Role } from '../src/modules/iam/domain/enums';
import { EmailOutboxService } from '../src/modules/iam/services/email-outbox.service';
import { VerificationMailer } from '../src/modules/iam/ports/verification-mailer';

/** Captura los tokens que normalmente viajarían por correo (verificación e invitación de miembro). */
class FakeEmailService {
  sent: { to: string; token: string }[] = [];
  async sendVerification(to: string, _name: string, token: string) {
    this.sent.push({ to, token });
  }
  async sendPasswordReset(to: string, name: string, token: string) {
    return this.sendVerification(to, name, token);
  }
  async sendMemberInvitation(to: string, name: string, token: string) {
    return this.sendVerification(to, name, token);
  }
  async sendAccountNotice() {}
  tokenFor(to: string): string {
    const found = [...this.sent].reverse().find((m) => m.to === to);
    if (!found) throw new Error(`sin correo para ${to}`);
    return found.token;
  }
}

const PASSWORD = 'Password123';

/**
 * SPEC-503 §10: escenarios 1 y 2 de punta a punta contra Postgres, más los casos negativos de E1, E2 y E9.
 * Cada prueba crea sus propias organizaciones y usuarios con nombres únicos (runId + contador), así que no
 * depende del orden ni de los datos de otras pruebas. Se usa la misma base que el resto de E2E (nexus_dev).
 */
describe('Acciones de plataforma (e2e) — SPEC-503 escenarios 1 y 2', () => {
  jest.setTimeout(30_000);

  let app: INestApplication;
  let dataSource: DataSource;
  let billing: BillingService;
  const mailer = new FakeEmailService();
  const runId = randomUUID().slice(0, 8);
  let sequence = 0;
  const emailOf = (n: string) => `platform.${n}.${runId}.${(sequence += 1)}@example.com`;

  beforeAll(async () => {
    process.env.IAM_REQUIRE_VERIFIED_EMAIL = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VerificationMailer)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    dataSource = app.get(DataSource);
    billing = app.get(BillingService);
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const expectErrorShape = (res: request.Response, code: string) => {
    expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'requestId']);
    expect(res.body.code).toBe(code);
  };
  const login = (email: string) =>
    request(server()).post('/api/auth/login').send({ email, password: PASSWORD });
  const suspend = (token: string, organizationId: string) =>
    request(server())
      .post(`/api/platform/organizations/${organizationId}/suspend`)
      .set('Authorization', `Bearer ${token}`);
  const reactivate = (token: string, organizationId: string) =>
    request(server())
      .post(`/api/platform/organizations/${organizationId}/reactivate`)
      .set('Authorization', `Bearer ${token}`);
  const closeWith = (token: string, body: { organizationName: string; password: string }) =>
    request(server())
      .post('/api/organizations/close')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  /** Registra y verifica una cuenta con su propia organización (tenant_admin) y devuelve sus datos y token. */
  async function registerTenant(n: string) {
    const email = emailOf(n);
    const organizationName = `Empresa plataforma ${n} ${runId}`;
    const reg = await request(server())
      .post('/api/auth/register')
      .send({ fullName: 'Admin Plataforma', email, password: PASSWORD, organizationName })
      .expect(201);
    await request(server())
      .post('/api/auth/verify-email')
      .send({ token: mailer.tokenFor(email) })
      .expect(200);
    const session = (await login(email).expect(200)).body;
    return {
      email,
      organizationName,
      organizationId: reg.body.organizationId as string,
      userId: await userIdOf(email),
      accessToken: session.accessToken as string,
    };
  }

  /**
   * Super Admin: una cuenta registrada normalmente a la que se concede is_super_admin en la BD (solo lo hace
   * el script seed-super-admin en producción; aquí se simula directamente). Vuelve a entrar para tener un token
   * emitido después de la concesión.
   */
  async function createSuperAdmin(n: string) {
    const base = await registerTenant(`super.${n}`);
    await dataSource.query(`UPDATE iam."user" SET is_super_admin = true WHERE user_id = $1`, [base.userId]);
    const session = (await login(base.email).expect(200)).body;
    return { ...base, accessToken: session.accessToken as string };
  }

  /** Da de alta un colaborador con el flujo real: invitación por correo + definición de contraseña. */
  async function createMember(admin: { accessToken: string }, n: string) {
    const email = emailOf(`colab.${n}`);
    await request(server())
      .post('/api/organizations/members')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ fullName: 'Colaborador Plataforma', email, role: Role.COLABORADOR })
      .expect(201);
    await request(server())
      .post('/api/auth/reset-password')
      .send({ token: await invitationTokenFor(email), newPassword: PASSWORD })
      .expect(200);
    return { email, userId: await userIdOf(email) };
  }

  /**
   * La invitación pasa por la outbox (asíncrona). Se despacha y se reintenta un instante hasta que
   * el mock capture el enlace; si no aparece, `tokenFor` lanza con el correo buscado.
   */
  async function invitationTokenFor(email: string): Promise<string> {
    const outbox = app.get(EmailOutboxService);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        return mailer.tokenFor(email);
      } catch {
        await outbox.dispatchDue();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
    return mailer.tokenFor(email);
  }

  async function userIdOf(email: string): Promise<string> {
    const [row] = await dataSource.query(`SELECT user_id FROM iam."user" WHERE email = $1`, [email]);
    return row.user_id as string;
  }

  async function orgStatus(organizationId: string): Promise<string> {
    const [row] = await dataSource.query(
      `SELECT status FROM admin.organization WHERE organization_id = $1`,
      [organizationId],
    );
    return row.status as string;
  }

  async function activeSubscriptions(organizationId: string): Promise<number> {
    const [row] = await dataSource.query(
      `SELECT count(*)::int AS n FROM billing.subscription WHERE organization_id = $1 AND status = 'active'`,
      [organizationId],
    );
    return row.n as number;
  }

  /** Sesiones de un usuario dentro de una organización (iam.session). */
  async function sessionsOf(userId: string, organizationId: string): Promise<{ revoked_at: Date | null }[]> {
    return dataSource.query(
      `SELECT revoked_at FROM iam.session WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId],
    );
  }

  /**
   * La auditoría se escribe después del commit y sin bloquear la respuesta (D8): se consulta con
   * reintentos breves hasta que aparezca el evento o se agote el tiempo (devuelve lista vacía).
   */
  async function auditEvents(organizationId: string, actionType: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rows: { actor_id: string | null; actor_type: string }[] = await dataSource.query(
        `SELECT actor_id, actor_type FROM audit.audit_event WHERE organization_id = $1 AND action_type = $2`,
        [organizationId, actionType],
      );
      if (rows.length > 0) return rows;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return [];
  }

  describe('Escenario 1 — suspender', () => {
    it('Super Admin suspende una organización activa: 200, el miembro recibe 401, sus sesiones quedan revocadas y se audita con el Super Admin como actor', async () => {
      const superAdmin = await createSuperAdmin('s1');
      const tenant = await registerTenant('s1');
      const member = await createMember(tenant, 's1');
      const memberToken = (await login(member.email).expect(200)).body.accessToken as string;
      // Baseline: el miembro accede antes de la suspensión con el token que ya tiene.
      await request(server())
        .get('/api/folders')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect(await orgStatus(tenant.organizationId)).toBe('active');

      const res = await suspend(superAdmin.accessToken, tenant.organizationId).expect(200);
      expect(res.body).toEqual({ id: tenant.organizationId, status: 'suspended' });

      expect(await orgStatus(tenant.organizationId)).toBe('suspended');
      // El token emitido antes de la suspensión deja de servir en la siguiente solicitud.
      await request(server())
        .get('/api/folders')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(401);

      const sessions = await sessionsOf(member.userId, tenant.organizationId);
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions.every((s) => s.revoked_at !== null)).toBe(true);

      const events = await auditEvents(tenant.organizationId, 'ORGANIZATION_SUSPENDED');
      expect(events).toHaveLength(1);
      expect(events[0].actor_id).toBe(superAdmin.userId);
    });
  });

  describe('Escenario 2 — reactivar', () => {
    it('reactiva una organización suspendida: 200 active, el miembro vuelve a entrar y, sin suscripción vigente, la cuota es 0', async () => {
      const superAdmin = await createSuperAdmin('s2a');
      const tenant = await registerTenant('s2a');
      const member = await createMember(tenant, 's2a');
      // Control: con suscripción vigente la organización tiene cuota > 0, así que el 0 posterior es significativo.
      expect(await billing.getStorageLimitBytes(tenant.organizationId)).toBeGreaterThan(BigInt(0));

      await suspend(superAdmin.accessToken, tenant.organizationId).expect(200);
      expectErrorShape(await login(member.email).expect(403), 'NO_ACTIVE_MEMBERSHIP');

      // Sin suscripción vigente: la suscripción deja de estar activa mientras la organización está suspendida.
      await dataSource.query(
        `UPDATE billing.subscription SET status = 'cancelled' WHERE organization_id = $1 AND status = 'active'`,
        [tenant.organizationId],
      );
      expect(await activeSubscriptions(tenant.organizationId)).toBe(0);

      const res = await reactivate(superAdmin.accessToken, tenant.organizationId).expect(200);
      expect(res.body).toEqual({ id: tenant.organizationId, status: 'active' });
      expect(await orgStatus(tenant.organizationId)).toBe('active');

      // El miembro vuelve a entrar con contraseña y una solicitud autenticada responde 200.
      const again = (await login(member.email).expect(200)).body.accessToken as string;
      await request(server())
        .get('/api/folders')
        .set('Authorization', `Bearer ${again}`)
        .expect(200);

      expect(await billing.getStorageLimitBytes(tenant.organizationId)).toBe(BigInt(0));

      const events = await auditEvents(tenant.organizationId, 'ORGANIZATION_REACTIVATED');
      expect(events).toHaveLength(1);
      expect(events[0].actor_id).toBe(superAdmin.userId);
    });

    it('reactiva una organización cancelada (cierre de SPEC-114): 200 active, el miembro vuelve a entrar y la cuota es 0', async () => {
      const superAdmin = await createSuperAdmin('s2b');
      const tenant = await registerTenant('s2b');
      const member = await createMember(tenant, 's2b');

      await closeWith(tenant.accessToken, {
        organizationName: tenant.organizationName,
        password: PASSWORD,
      }).expect(200);
      expect(await orgStatus(tenant.organizationId)).toBe('cancelled');
      expectErrorShape(await login(member.email).expect(403), 'NO_ACTIVE_MEMBERSHIP');

      const res = await reactivate(superAdmin.accessToken, tenant.organizationId).expect(200);
      expect(res.body).toEqual({ id: tenant.organizationId, status: 'active' });
      expect(await orgStatus(tenant.organizationId)).toBe('active');

      await login(member.email).expect(200);
      // El cierre canceló la suscripción: la organización reabierta no tiene cuota hasta contratar un plan.
      expect(await activeSubscriptions(tenant.organizationId)).toBe(0);
      expect(await billing.getStorageLimitBytes(tenant.organizationId)).toBe(BigInt(0));
    });
  });

  describe('Casos negativos', () => {
    it('E2: reactivar una organización ya activa responde 422 INVALID_ORGANIZATION_TRANSITION y no cambia nada', async () => {
      const superAdmin = await createSuperAdmin('neg2');
      const tenant = await registerTenant('neg2');

      const res = await reactivate(superAdmin.accessToken, tenant.organizationId).expect(422);
      expectErrorShape(res, 'INVALID_ORGANIZATION_TRANSITION');
      expect(await orgStatus(tenant.organizationId)).toBe('active');
    });

    it('E1: suspender la propia organización del Super Admin responde 422 CANNOT_SUSPEND_OWN_ORGANIZATION y no cambia nada', async () => {
      const superAdmin = await createSuperAdmin('neg1');

      const res = await suspend(superAdmin.accessToken, superAdmin.organizationId).expect(422);
      expectErrorShape(res, 'CANNOT_SUSPEND_OWN_ORGANIZATION');
      expect(await orgStatus(superAdmin.organizationId)).toBe('active');
    });

    it('E9: un tenant_admin que no es Super Admin recibe 403 PLATFORM_ADMIN_REQUIRED al suspender y la organización sigue activa', async () => {
      const tenantAdmin = await registerTenant('e9');
      const target = await registerTenant('e9target');

      const res = await suspend(tenantAdmin.accessToken, target.organizationId).expect(403);
      expectErrorShape(res, 'PLATFORM_ADMIN_REQUIRED');

      expect(await orgStatus(target.organizationId)).toBe('active');
      const rows: { event_id: string }[] = await dataSource.query(
        `SELECT event_id FROM audit.audit_event WHERE organization_id = $1 AND action_type = 'ORGANIZATION_SUSPENDED'`,
        [target.organizationId],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('Lista de solicitudes con instalación (SPEC-502)', () => {
    it('tras aprobar, la lista devuelve installationId y estado Pendiente, y ese id sirve para PATCH de la instalación', async () => {
      const superAdmin = await createSuperAdmin('s502a');
      const tenant = await registerTenant('s502a');
      const created = await request(server())
        .post('/api/organizations/installation-requests')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .send({ requestedModel: DeploymentModel.ON_PREMISES })
        .expect(201);
      const requestId = created.body.id as string;

      const approved = await request(server())
        .post(`/api/platform/installation-requests/${requestId}/approve`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({ operatorName: `Operador ${runId}`, hostReference: `srv-${runId}.test` })
        .expect(200);
      const installationId = approved.body.installationId as string;

      const listed = await request(server())
        .get('/api/platform/installation-requests?status=Aprobada')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .expect(200);
      const item = listed.body.items.find((i: { id: string }) => i.id === requestId);
      expect(item).toMatchObject({
        id: requestId,
        status: 'Aprobada',
        installationId,
        installationStatus: 'Pendiente',
        operatorName: `Operador ${runId}`,
        hostReference: `srv-${runId}.test`,
      });

      await request(server())
        .patch(`/api/platform/installations/${installationId}`)
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .send({ status: 'En proceso' })
        .expect(200);

      const relisted = await request(server())
        .get('/api/platform/installation-requests?status=Aprobada')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .expect(200);
      const updated = relisted.body.items.find((i: { id: string }) => i.id === requestId);
      expect(updated).toMatchObject({ installationId, installationStatus: 'En proceso' });
    });

    it('una solicitud Pendiente aparece con los cuatro campos de instalación en null', async () => {
      const superAdmin = await createSuperAdmin('s502b');
      const tenant = await registerTenant('s502b');
      const created = await request(server())
        .post('/api/organizations/installation-requests')
        .set('Authorization', `Bearer ${tenant.accessToken}`)
        .send({ requestedModel: DeploymentModel.HYBRID })
        .expect(201);
      const requestId = created.body.id as string;

      const listed = await request(server())
        .get('/api/platform/installation-requests?status=Pendiente')
        .set('Authorization', `Bearer ${superAdmin.accessToken}`)
        .expect(200);
      const item = listed.body.items.find((i: { id: string }) => i.id === requestId);
      expect(item).toMatchObject({
        id: requestId,
        status: 'Pendiente',
        installationId: null,
        installationStatus: null,
        operatorName: null,
        hostReference: null,
      });
    });
  });
});
