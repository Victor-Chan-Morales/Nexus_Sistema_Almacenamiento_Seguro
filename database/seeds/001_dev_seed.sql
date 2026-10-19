-- Datos de desarrollo/demo. NO se ejecuta con las migraciones (ver database/README.md, "Seeds").
-- Separado a propósito: un entorno de producción corre las migraciones y nunca este archivo.
-- Idempotente: se puede correr varias veces sin duplicar filas (ON CONFLICT DO NOTHING).
-- Los password_hash son texto de relleno, NO hashes reales — nadie puede iniciar sesión con
-- estos usuarios hasta que el equipo los reemplace con un hash Argon2id real.

BEGIN;

-- Organización de demo
INSERT INTO admin.organization (organization_id, name, status, deployment_model)
VALUES ('00000000-0000-0000-0000-000000000001', 'Organización de Prueba', 'active', 'cloud')
ON CONFLICT (organization_id) DO NOTHING;

-- Planes (catálogo, no específicos de una organización)
INSERT INTO billing.plan (plan_id, name, storage_limit_gb, user_limit, price_monthly) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'Free',    5,  3, 0.00),
  ('00000000-0000-0000-0000-0000000000a2', 'Pro',    100, 25, 19.99)
ON CONFLICT (plan_id) DO NOTHING;

INSERT INTO billing.subscription (subscription_id, organization_id, plan_id, status, start_date)
VALUES ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2', 'active', CURRENT_DATE)
ON CONFLICT (subscription_id) DO NOTHING;

-- Destino de almacenamiento (MinIO local, ya "conectado" para la demo) y cuota inicial
INSERT INTO files.destination (destination_id, organization_id, provider_type, connection_status,
                                is_enabled, is_default, bucket_or_prefix, connection_details_encrypted)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
        'minio', 'Conectado', true, true, 'org-prueba',
        'seed-data-placeholder-not-encrypted')
ON CONFLICT (destination_id) DO NOTHING;

INSERT INTO files.tenant_quota (organization_id, confirmed_usage_bytes, active_reservations_bytes)
VALUES ('00000000-0000-0000-0000-000000000001', 0, 0)
ON CONFLICT (organization_id) DO NOTHING;

-- KEK de la organización: solo la referencia externa vive aquí (DA-05); la llave real
-- no existe en este seed, así que no cifren archivos de verdad contra este key_id.
INSERT INTO files.tenant_encryption_key (key_id, organization_id, external_reference, status)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001',
        'dev-secret://kek/org-prueba', 'active')
ON CONFLICT (key_id) DO NOTHING;

-- Usuarios de demo
INSERT INTO iam."user" (user_id, email, password_hash, full_name, email_verified, status) VALUES
  ('00000000-0000-0000-0000-0000000000e1', 'admin@prueba.test', 'seed-data-not-a-real-hash-do-not-use', 'Admin de Prueba', true, 'active'),
  ('00000000-0000-0000-0000-0000000000e2', 'colaborador@prueba.test', 'seed-data-not-a-real-hash-do-not-use', 'Colaborador de Prueba', true, 'active')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO iam.membership (membership_id, user_id, organization_id, role_id, status) VALUES
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1',
   '00000000-0000-0000-0000-000000000001', (SELECT role_id FROM iam.role WHERE name = 'tenant_admin'), 'active'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2',
   '00000000-0000-0000-0000-000000000001', (SELECT role_id FROM iam.role WHERE name = 'colaborador'), 'active')
ON CONFLICT (membership_id) DO NOTHING;

-- Un equipo, un espacio personal y un Team Drive con una carpeta raíz cada uno
INSERT INTO files.team (team_id, organization_id, name, created_by)
VALUES ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001',
        'Equipo de Prueba', '00000000-0000-0000-0000-0000000000e1')
ON CONFLICT (team_id) DO NOTHING;

INSERT INTO files.team_member (team_id, user_id) VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000e2')
ON CONFLICT DO NOTHING;

INSERT INTO files.drive (drive_id, organization_id, type, owner_user_id, name) VALUES
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001',
   'personal', '00000000-0000-0000-0000-0000000000e2', 'Mi espacio')
ON CONFLICT (drive_id) DO NOTHING;

INSERT INTO files.drive (drive_id, organization_id, type, team_id, name) VALUES
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001',
   'team', '00000000-0000-0000-0000-000000000011', 'Drive del equipo')
ON CONFLICT (drive_id) DO NOTHING;

INSERT INTO files.folder (folder_id, organization_id, drive_id, name, created_by) VALUES
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000021', 'Raíz', '00000000-0000-0000-0000-0000000000e2'),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000022', 'Raíz', '00000000-0000-0000-0000-0000000000e1')
ON CONFLICT (folder_id) DO NOTHING;

COMMIT;
