import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { REFRESH_COOKIE_NAME } from '../src/modules/iam/constants';
import { Organization } from '../src/modules/iam/entities/organization.entity';
import { User } from '../src/modules/iam/entities/user.entity';
import { Session } from '../src/modules/iam/entities/session.entity';
import { EmailOutboxService } from '../src/modules/iam/services/email-outbox.service';
import { RegistrationHooks } from '../src/modules/iam/registration-hooks';
import { VerificationMailer } from '../src/modules/iam/ports/verification-mailer';

/** Captura el token que normalmente viajaría por correo (en producción solo está en el email). */
class FakeEmailService {
  sent: { to: string; token: string }[] = [];
  failing = false;
  async sendVerification(to: string, _name: string, token: string) {
    if (this.failing) throw new Error('SMTP caído');
    this.sent.push({ to, token });
  }
  tokenFor(to: string): string {
    const found = [...this.sent].reverse().find((m) => m.to === to);
    if (!found) throw new Error(`sin correo para ${to}`);
    return found.token;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('IAM (e2e) — contrato CONTRACTS.md v0.2', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let jwt: JwtService;
  const mailer = new FakeEmailService();
  const stamp = Date.now();
  const emailOf = (n: string) => `iam.${n}.${stamp}@example.com`;
  const body = (email: string, org = `Org ${email}`) => ({
    fullName: 'Test User',
    email,
    password: 'Password123',
    organizationName: org,
  });

  beforeAll(async () => {
    process.env.IAM_REQUIRE_VERIFIED_EMAIL = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VerificationMailer)
      .useValue(mailer)
      .compile();

    // Billing y Files aún no registran sus hooks en esta rama; el registro los exige, así que aquí se simulan.
    const hooks = moduleRef.get(RegistrationHooks);
    hooks.register('demo-subscription', async () => undefined);
    hooks.register('personal-drive', async () => undefined);

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    dataSource = app.get(DataSource);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const expectErrorShape = (res: request.Response, code: string) => {
    expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'requestId']);
    expect(res.body.code).toBe(code);
    expect(res.body.requestId).toMatch(UUID);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\(/i);
  };
  const refreshCookieOf = (res: request.Response): string => {
    const raw = ([] as string[])
      .concat((res.headers['set-cookie'] as unknown as string[] | string) ?? [])
      .find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
    if (!raw) throw new Error('cookie de refresh ausente');
    return raw;
  };
  const cookieHeader = (setCookie: string) => setCookie.split(';')[0];

  async function registerAndVerify(n: string) {
    const email = emailOf(n);
    const reg = await request(server()).post('/api/auth/register').send(body(email)).expect(201);
    await request(server())
      .post('/api/auth/verify-email')
      .send({ token: mailer.tokenFor(email) })
      .expect(200);
    return { email, ...reg.body };
  }
  const login = (email: string) =>
    request(server()).post('/api/auth/login').send({ email, password: 'Password123' });

  it('registro válido devuelve exactamente el contrato y persiste entidades relacionadas', async () => {
    const email = emailOf('ok');
    const res = await request(server()).post('/api/auth/register').send(body(email)).expect(201);

    expect(Object.keys(res.body).sort()).toEqual(
      ['organizationId', 'role', 'userId', 'verificationRequired'].sort(),
    );
    expect(res.body.role).toBe('tenant_admin');
    expect(res.body.verificationRequired).toBe(true);

    const user = await dataSource.getRepository(User).findOneByOrFail({ email });
    expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await dataSource.getRepository(Organization).count({ where: { name: `Org ${email}` } })).toBe(1);
  });

  it('correo duplicado (sin distinguir mayúsculas): 409 con error común y sin registros parciales', async () => {
    const email = emailOf('dup');
    await request(server()).post('/api/auth/register').send(body(email)).expect(201);
    const secondOrg = `Org segunda ${stamp}`;
    const res = await request(server())
      .post('/api/auth/register')
      .send(body(email.toUpperCase(), secondOrg))
      .expect(409);
    expectErrorShape(res, 'EMAIL_ALREADY_REGISTERED');
    expect(await dataSource.getRepository(Organization).count({ where: { name: secondOrg } })).toBe(0);
  });

  it('datos inválidos o un organizationId del cliente: 400 y no se crea nada', async () => {
    const email = emailOf('bad');
    const weak = await request(server())
      .post('/api/auth/register')
      .send({ ...body(email), password: 'corta' })
      .expect(400);
    expectErrorShape(weak, 'VALIDATION_ERROR');

    const forged = await request(server())
      .post('/api/auth/register')
      .send({ ...body(email), organizationId: '00000000-0000-0000-0000-000000000000' })
      .expect(400);
    expectErrorShape(forged, 'VALIDATION_ERROR');
    expect(await dataSource.getRepository(User).count({ where: { email } })).toBe(0);
  });

  it('login exige correo verificado y el token de verificación es de un solo uso', async () => {
    const email = emailOf('verify');
    await request(server()).post('/api/auth/register').send(body(email)).expect(201);

    expectErrorShape(await login(email).expect(403), 'EMAIL_NOT_VERIFIED');

    const token = mailer.tokenFor(email);
    await request(server()).post('/api/auth/verify-email').send({ token }).expect(200);
    expectErrorShape(
      await request(server()).post('/api/auth/verify-email').send({ token }).expect(400),
      'INVALID_VERIFICATION_TOKEN',
    );
    await login(email).expect(200);
  });

  it('login inválido: misma respuesta para correo inexistente y contraseña incorrecta', async () => {
    const { email } = await registerAndVerify('uniform');
    const wrongPass = await request(server())
      .post('/api/auth/login')
      .send({ email, password: 'Incorrecta1' });
    const unknown = await request(server())
      .post('/api/auth/login')
      .send({ email: emailOf('nadie'), password: 'Incorrecta1' });

    expect(wrongPass.status).toBe(401);
    expect(unknown.status).toBe(401);
    expectErrorShape(wrongPass, 'INVALID_CREDENTIALS');
    expect(unknown.body.code).toBe(wrongPass.body.code);
    expect(unknown.body.message).toBe(wrongPass.body.message);
  });

  it('login válido devuelve el esquema del contrato (expiresAt ISO UTC) y cookie HttpOnly', async () => {
    const { email, userId, organizationId } = await registerAndVerify('login');
    const res = await login(email).expect(200);

    expect(Object.keys(res.body).sort()).toEqual(
      ['accessToken', 'expiresAt', 'organization', 'role', 'user'].sort(),
    );
    expect(Object.keys(res.body.user).sort()).toEqual(['email', 'fullName', 'id']);
    expect(res.body.organization.id).toBe(organizationId);
    expect(res.body.role).toBe('tenant_admin');

    const expiresAt = new Date(res.body.expiresAt);
    expect(res.body.expiresAt).toBe(expiresAt.toISOString());
    const msLeft = expiresAt.getTime() - Date.now();
    expect(msLeft).toBeGreaterThan(14 * 60_000);
    expect(msLeft).toBeLessThanOrEqual(15 * 60_000);

    const cookie = refreshCookieOf(res);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/auth');
    const rawRefresh = cookieHeader(cookie).split('=')[1];
    expect(JSON.stringify(res.body)).not.toContain(rawRefresh);

    // Diagrama: Session guarda solo refreshTokenHash; nunca el token en claro.
    const sessions = await dataSource.getRepository(Session).find({ where: { userId } });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s: Session) => s.refreshTokenHash.length === 64 && s.refreshTokenHash !== rawRefresh)).toBe(true);
  });

  it('una cuenta con mfaEnabled=true no inicia sesión (falla cerrado hasta implementar TOTP)', async () => {
    const { email } = await registerAndVerify('mfa');
    // La BD exige también mfa_secret_encrypted (CHECK ck_user_mfa_requires_secret)
    await dataSource.query(
      'UPDATE iam."user" SET mfa_enabled = true, mfa_secret_encrypted = $2 WHERE email = $1',
      [email, 'secreto-de-prueba'],
    );
    expectErrorShape(await login(email).expect(403), 'MFA_NOT_SUPPORTED');
  });

  it('/auth/me: 401 sin sesión, 401 con token vencido, y el tenant lo decide el backend', async () => {
    const { email, userId, organizationId } = await registerAndVerify('me');
    expectErrorShape(await request(server()).get('/api/auth/me').expect(401), 'UNAUTHORIZED');

    const expired = jwt.sign({ sub: userId, org: organizationId, role: 'tenant_admin' }, { expiresIn: -10 });
    await request(server()).get('/api/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);

    const { body: session } = await login(email).expect(200);
    const forged = '00000000-0000-0000-0000-000000000000';
    const me = await request(server())
      .get('/api/auth/me')
      .query({ organizationId: forged })
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('x-organization-id', forged)
      .expect(200);

    expect(Object.keys(me.body).sort()).toEqual(['organization', 'role', 'user']);
    expect(me.body.organization.id).toBe(organizationId);
    expect(me.body.user.email).toBe(email);
    expect(me.body.role).toBe('tenant_admin');
  });

  it('refresh rota la cookie y reutilizar un token anterior cierra la sesión', async () => {
    const { email } = await registerAndVerify('refresh');
    const first = refreshCookieOf(await login(email).expect(200));

    const rotated = await request(server())
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(first))
      .expect(200);
    expect(rotated.body.accessToken).toBeDefined();
    const second = refreshCookieOf(rotated);
    expect(cookieHeader(second)).not.toBe(cookieHeader(first));

    expectErrorShape(
      await request(server()).post('/api/auth/refresh').set('Cookie', cookieHeader(first)).expect(401),
      'INVALID_SESSION',
    );
    // La reutilización también revocó la sesión rotada.
    await request(server()).post('/api/auth/refresh').set('Cookie', cookieHeader(second)).expect(401);
  });

  it('logout revoca el refresh token', async () => {
    const { email } = await registerAndVerify('logout');
    const cookie = refreshCookieOf(await login(email).expect(200));

    await request(server()).post('/api/auth/logout').set('Cookie', cookieHeader(cookie)).expect(204);
    await request(server()).post('/api/auth/refresh').set('Cookie', cookieHeader(cookie)).expect(401);
  });

  it('si el SMTP falla al registrar, la cuenta existe, el correo queda en la outbox y se envía al reintentar', async () => {
    const email = emailOf('outbox');
    mailer.failing = true;
    try {
      await request(server()).post('/api/auth/register').send(body(email)).expect(201);
    } finally {
      mailer.failing = false;
    }

    const [pending] = await dataSource.query(
      `SELECT status, attempts, encrypted_payload FROM iam.email_outbox WHERE recipient_email = $1`,
      [email],
    );
    expect(pending.status).toBe('pending');
    expect(pending.attempts).toBe(1);
    // Formato iv.tag.datos (AES-256-GCM en base64): el token no queda en claro.
    expect(pending.encrypted_payload.split('.')).toHaveLength(3);

    // Se adelanta el siguiente intento para no esperar el backoff real.
    await dataSource.query(
      `UPDATE iam.email_outbox SET next_attempt_at = now() - interval '1 second' WHERE recipient_email = $1`,
      [email],
    );
    await app.get(EmailOutboxService).dispatchDue();

    const [sent] = await dataSource.query(
      `SELECT status, encrypted_payload FROM iam.email_outbox WHERE recipient_email = $1`,
      [email],
    );
    expect(sent.status).toBe('sent');
    expect(sent.encrypted_payload).toBe('');

    await request(server())
      .post('/api/auth/verify-email')
      .send({ token: mailer.tokenFor(email) })
      .expect(200);
  });
});
