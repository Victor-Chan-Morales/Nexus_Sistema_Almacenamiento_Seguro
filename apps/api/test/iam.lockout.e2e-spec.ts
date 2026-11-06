import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

/**
 * SPEC-112 · Escenario 7. Requiere PostgreSQL de desarrollo con las migraciones aplicadas (incluida
 * 20261104090000_add_user_locked_until) y JWT_SECRET en el .env de la raíz. Puede pegarse tal cual dentro de
 * iam.e2e-spec.ts si se prefiere un solo archivo.
 */
describe('IAM e2e · bloqueo progresivo (SPEC-112)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const attempts = async (email: string) => {
    const rows = await dataSource.query(
      'SELECT failed_login_attempts AS attempts, locked_until AS "lockedUntil" FROM iam."user" WHERE email = $1',
      [email],
    );
    return rows[0] as { attempts: number; lockedUntil: Date | null };
  };

  it('Escenario 7: 10 intentos fallidos simultáneos suman exactamente 10 y dejan el bloqueo máximo', async () => {
    const email = `lockout-${Date.now()}@test.com`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ fullName: 'Prueba Bloqueo', email, password: 'Password123', organizationName: 'Org Bloqueo' })
      .expect(201);

    const before = Date.now();
    // Las 10 peticiones leen la cuenta antes de que termine el primer Argon2, así que todas cuentan.
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'Incorrecta1' }),
      ),
    );

    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(401));
    expect(new Set(responses.map((r) => r.body.code))).toEqual(new Set(['INVALID_CREDENTIALS']));

    const row = await attempts(email);
    expect(row.attempts).toBe(10); // incremento atómico: ningún fallo se pierde
    expect(row.lockedUntil).not.toBeNull();
    const seconds = (new Date(row.lockedUntil as Date).getTime() - before) / 1000;
    expect(seconds).toBeGreaterThan(29 * 60); // 10.º fallo: min(60 × 2^5, 1800) = 1800 s
    expect(seconds).toBeLessThanOrEqual(30 * 60 + 60);
  });

  it('con la cuenta bloqueada, la contraseña correcta responde igual y no cuenta', async () => {
    const email = `lockout-ok-${Date.now()}@test.com`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ fullName: 'Prueba Bloqueo', email, password: 'Password123', organizationName: 'Org Bloqueo' })
      .expect(201);
    await dataSource.query(
      `UPDATE iam."user" SET email_verified = true, failed_login_attempts = 5,
              locked_until = now() + interval '1 minute' WHERE email = $1`,
      [email],
    );

    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'Password123' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect((await attempts(email)).attempts).toBe(5); // el intento durante el bloqueo no cuenta
  });
});
