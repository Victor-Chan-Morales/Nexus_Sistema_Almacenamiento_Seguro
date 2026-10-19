-- migrate:up
-- Esquemas por dominio (MER v3). Ya no son un límite de seguridad (todo lo maneja una sola conexión/servicio):
-- son una convención para organizar 29 tablas. Ver database/README.md, sección "Esquemas".

CREATE SCHEMA admin;
COMMENT ON SCHEMA admin IS 'Dominio Admin: organizaciones (tenants), solicitudes e instalaciones, comprobaciones y referencias a secretos de conexión.';
CREATE SCHEMA iam;
COMMENT ON SCHEMA iam IS 'Dominio IAM: usuarios, membresías por organización, roles, sesiones y tokens de un solo uso.';
CREATE SCHEMA files;
COMMENT ON SCHEMA files IS 'Dominio Files: espacios, carpetas, archivos y versiones, destinos de almacenamiento, KEK, cargas, cuota, enlaces y ACL.';
CREATE SCHEMA billing;
COMMENT ON SCHEMA billing IS 'Dominio Billing: planes, suscripciones, revisiones de plan y operaciones de facturación simuladas.';
CREATE SCHEMA audit;
COMMENT ON SCHEMA audit IS 'Dominio Audit: eventos de auditoría append-only con cadena de hashes por organización y checkpoints firmados.';

-- migrate:down
DROP SCHEMA audit;
DROP SCHEMA billing;
DROP SCHEMA files;
DROP SCHEMA iam;
DROP SCHEMA admin;
