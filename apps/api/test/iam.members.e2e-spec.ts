import * as argon2 from 'argon2';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';

/**
 * SPEC-108 · Escenario 7. Requiere PostgreSQL de desarrollo con las migraciones aplicadas y JWT_SECRET en el .env de
 * la raíz. Puede pegarse dentro de iam.e2e-spec.ts si se prefiere un solo archivo.
 */
describe('IAM e2e · administrar miembros (SPEC-108)', () => {
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

  const http = () => request(app.getHttpServer());
  const login = async (email: string, password: string): Promise<string> => {
    const res = await http().post('/api/auth/login').send({ email, password }).expect(200);
    return res.body.accessToken as string;
  };

  it('Escenario 7: dos administradores que se eliminan entre sí a la vez dejan al menos uno', async () => {
    const stamp = Date.now();
    const emailA = `admin-a-${stamp}@test.com`;
    const emailB = `admin-b-${stamp}@test.com`;
    const password = 'Password123';

    // Organización con el administrador A
    await http()
      .post('/api/auth/register')
      .send({ fullName: 'Admin A', email: emailA, password, organizationName: `Org ${stamp}` })
      .expect(201);
    await dataSource.query('UPDATE iam."user" SET email_verified = true WHERE email = $1', [emailA]);
    const tokenA = await login(emailA, password);

    // A da de alta a B como administrador; B recibe una contraseña conocida para poder iniciar sesión
    const added = await http()
      .post('/api/organizations/members')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ fullName: 'Admin B', email: emailB, role: 'tenant_admin' })
      .expect(201);
    await dataSource.query('UPDATE iam."user" SET email_verified = true, password_hash = $2 WHERE email = $1', [
      emailB,
      await argon2.hash(password, { type: argon2.argon2id }),
    ]);
    const tokenB = await login(emailB, password);

    const list = await http().get('/api/organizations/members').set('Authorization', `Bearer ${tokenA}`).expect(200);
    const membershipA = (list.body.members as Array<{ id: string; email: string }>).find((m) => m.email === emailA)!.id;
    const membershipB = added.body.id as string;

    const [{ organization_id: organizationId }] = await dataSource.query(
      'SELECT organization_id FROM iam.membership WHERE membership_id = $1',
      [membershipA],
    );

    // Se eliminan mutuamente al mismo tiempo
    const [aDeletesB, bDeletesA] = await Promise.all([
      http().delete(`/api/organizations/members/${membershipB}`).set('Authorization', `Bearer ${tokenA}`),
      http().delete(`/api/organizations/members/${membershipA}`).set('Authorization', `Bearer ${tokenB}`),
    ]);

    const statuses = [aDeletesB.status, bDeletesA.status].sort();
    expect(statuses[0]).toBe(204); // exactamente una eliminación prospera
    expect([401, 403]).toContain(statuses[1]); // la otra: token ya sin membresía (401) o actor ya sin rol (403)

    const [{ admins }] = await dataSource.query(
      `SELECT COUNT(*)::int AS admins
         FROM iam.membership m
         JOIN iam.role r ON r.role_id = m.role_id
         JOIN iam."user" u ON u.user_id = m.user_id
        WHERE m.organization_id = $1 AND m.status = 'active' AND r.name = 'tenant_admin' AND u.status = 'active'`,
      [organizationId],
    );
    expect(admins).toBeGreaterThanOrEqual(1);
  });
});
