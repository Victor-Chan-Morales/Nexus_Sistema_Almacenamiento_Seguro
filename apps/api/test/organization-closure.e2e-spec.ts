import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { BillingService } from '../src/modules/billing/billing.service';
import { REFRESH_COOKIE_NAME } from '../src/modules/iam/constants';
import { Role } from '../src/modules/iam/domain/enums';
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
  tokenFor(to: string): string {
    const found = [...this.sent].reverse().find((m) => m.to === to);
    if (!found) throw new Error(`sin correo para ${to}`);
    return found.token;
  }
}

const PASSWORD = 'Password123';

describe('Cierre de empresa (e2e) — SPEC-114 / CONTRACTS.md v0.6', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const mailer = new FakeEmailService();
  const stamp = Date.now();
  const emailOf = (n: string) => `closure.${n}.${stamp}@example.com`;

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
  const closeWith = (token: string, body: { organizationName: string; password: string }) =>
    request(server()).post('/api/organizations/close').set('Authorization', `Bearer ${token}`).send(body);

  /** Registra y verifica un tenant_admin y devuelve su token y su organización. */
  async function registerAdmin(n: string) {
    const email = emailOf(n);
    const organizationName = `Empresa cierre ${n} ${stamp}`;
    const reg = await request(server())
      .post('/api/auth/register')
      .send({ fullName: 'Admin Cierre', email, password: PASSWORD, organizationName })
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
      accessToken: session.accessToken as string,
    };
  }

  /** Da de alta un colaborador con el flujo real: invitación por correo + definición de contraseña. */
  async function addColaborador(admin: { accessToken: string }, n: string) {
    const email = emailOf(`colab.${n}`);
    await request(server())
      .post('/api/organizations/members')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ fullName: 'Colaborador Cierre', email, role: Role.COLABORADOR })
      .expect(201);
    await request(server())
      .post('/api/auth/reset-password')
      .send({ token: await invitationTokenFor(email), newPassword: PASSWORD })
      .expect(200);
    return email;
  }

  /**
   * La invitación pasa por la outbox (asíncrona). Se despacha y se reintenta un instante hasta que
   * el mock capture el enlace; si no aparece en ~3 s, `tokenFor` lanza con el correo buscado.
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

  /** Estado observable en la base: lo que debe cambiar (o no) al cerrar. */
  async function snapshot(organizationId: string) {
    const [org] = await dataSource.query(
      `SELECT status FROM admin.organization WHERE organization_id = $1`,
      [organizationId],
    );
    const [subs] = await dataSource.query(
      `SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
         FROM billing.subscription WHERE organization_id = $1`,
      [organizationId],
    );
    const [sessions] = await dataSource.query(
      `SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS open
         FROM iam.session WHERE organization_id = $1`,
      [organizationId],
    );
    const [files] = await dataSource.query(
      `SELECT (SELECT count(*) FROM files.folder WHERE organization_id = $1)::int AS folders,
              (SELECT count(*) FROM files.file WHERE organization_id = $1)::int AS files`,
      [organizationId],
    );
    return { orgStatus: org.status as string, subs, openSessions: sessions.open as number, files };
  }

  it('colaborador → 403 FORBIDDEN_ROLE y no cambia nada (Escenario 5)', async () => {
    const admin = await registerAdmin('forbidden');
    const colabEmail = await addColaborador(admin, 'forbidden');
    const colab = (await login(colabEmail).expect(200)).body;
    const before = await snapshot(admin.organizationId);

    const res = await closeWith(colab.accessToken, {
      organizationName: admin.organizationName,
      password: PASSWORD,
    }).expect(403);
    expectErrorShape(res, 'FORBIDDEN_ROLE');

    expect(await snapshot(admin.organizationId)).toEqual(before);
  });

  it('nombre distinto → 422 ORGANIZATION_NAME_MISMATCH y no cambia nada (Escenario 4)', async () => {
    const admin = await registerAdmin('mismatch');
    const before = await snapshot(admin.organizationId);

    const res = await closeWith(admin.accessToken, {
      organizationName: 'Otro nombre',
      password: PASSWORD,
    }).expect(422);
    expectErrorShape(res, 'ORGANIZATION_NAME_MISMATCH');

    expect(await snapshot(admin.organizationId)).toEqual(before);
  });

  it('contraseña incorrecta → 401 INVALID_CREDENTIALS y no cambia nada (Escenario 4)', async () => {
    const admin = await registerAdmin('badpass');
    const before = await snapshot(admin.organizationId);

    const res = await closeWith(admin.accessToken, {
      organizationName: admin.organizationName,
      password: 'ContraseñaIncorrecta1',
    }).expect(401);
    expectErrorShape(res, 'INVALID_CREDENTIALS');

    expect(await snapshot(admin.organizationId)).toEqual(before);
  });

  it('cierre exitoso: bloquea la organización, revoca sesiones y conserva archivos (Escenarios 1, 2 y 3)', async () => {
    const admin = await registerAdmin('ok');
    const colabEmail = await addColaborador(admin, 'ok');
    const colab = (await login(colabEmail).expect(200)).body;
    // Baseline: el colaborador sí accede antes del cierre.
    await request(server())
      .get('/api/folders')
      .set('Authorization', `Bearer ${colab.accessToken}`)
      .expect(200);
    const before = await snapshot(admin.organizationId);
    expect(before.orgStatus).toBe('active');
    expect(before.openSessions).toBeGreaterThanOrEqual(2);
    expect(before.files.folders).toBeGreaterThanOrEqual(1);

    const res = await closeWith(admin.accessToken, {
      organizationName: admin.organizationName,
      password: PASSWORD,
    }).expect(200);
    expect(res.body).toEqual({ closed: true });
    // La cookie de refresco se limpia (Express la reemplaza por una vacía con fecha pasada).
    const setCookie = ([] as string[]).concat((res.headers['set-cookie'] as unknown as string[]) ?? []);
    expect(setCookie.some((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=;`))).toBe(true);

    const after = await snapshot(admin.organizationId);
    expect(after.orgStatus).toBe('cancelled');
    expect(after.subs.active).toBe(0);
    expect(after.subs.cancelled).toBeGreaterThanOrEqual(1);
    expect(after.openSessions).toBe(0);
    // Escenario 3: filas de archivos y carpetas intactas (el cierre no toca Files).
    expect(after.files).toEqual(before.files);

    // Escenario 2: nadie recibe acceso con los tokens previos ni puede volver a entrar.
    await request(server())
      .get('/api/folders')
      .set('Authorization', `Bearer ${colab.accessToken}`)
      .expect(401);
    await request(server())
      .get('/api/folders')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(401);
    // Con contraseña correcta, IAM informa que no hay organización activa (la cuenta no puede entrar).
    for (const email of [colabEmail, admin.email]) {
      expectErrorShape(await login(email).expect(403), 'NO_ACTIVE_MEMBERSHIP');
    }
  });

  it('si falla a mitad de la transacción de cierre, no queda nada cerrado (rollback)', async () => {
    const admin = await registerAdmin('rollback');
    const before = await snapshot(admin.organizationId);

    const billing = app.get(BillingService);
    const spy = jest
      .spyOn(billing, 'cancelActive')
      .mockRejectedValueOnce(new Error('fallo simulado en billing'));

    try {
      // El paso A (organización a cancelled) ya se ejecutó dentro de la transacción cuando falla el paso B.
      await closeWith(admin.accessToken, {
        organizationName: admin.organizationName,
        password: PASSWORD,
      }).expect(500);
    } finally {
      spy.mockRestore();
    }

    expect(await snapshot(admin.organizationId)).toEqual(before);
    // La sesión del administrador sigue viva tras el intento fallido.
    await request(server())
      .get('/api/folders')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
  });
});
