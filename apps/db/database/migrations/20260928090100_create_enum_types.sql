-- migrate:up
-- Tipos ENUM nativos para las columnas de estado/tipo con valores cerrados.
-- Las etiquetas son EXACTAMENTE las del diccionario del MER (incluidas las de las cuatro máquinas de estado en español).
-- Agregar un valor: ALTER TYPE ... ADD VALUE en una migración con "-- migrate:up transaction:false".

CREATE TYPE admin.organization_status AS ENUM ('active', 'suspended', 'cancelled');
COMMENT ON TYPE admin.organization_status IS 'Estado de una organización.';

CREATE TYPE admin.deployment_model AS ENUM ('cloud', 'on_premises', 'hybrid');
COMMENT ON TYPE admin.deployment_model IS 'Modelo de despliegue: nube, servidor propio (on-premises) o híbrido.';

CREATE TYPE admin.request_status AS ENUM ('Pendiente', 'Aprobada', 'Rechazada', 'Cerrada');
COMMENT ON TYPE admin.request_status IS 'Estados de una solicitud de instalación (documento de arquitectura).';

CREATE TYPE admin.installation_status AS ENUM ('No solicitada', 'Pendiente', 'En proceso', 'Operativa', 'Fallida');
COMMENT ON TYPE admin.installation_status IS 'Estados de una instalación (documento de arquitectura).';

CREATE TYPE admin.check_type AS ENUM ('connectivity', 'space', 'docker', 'ports', 'certs', 'write_read_delete_test');
COMMENT ON TYPE admin.check_type IS 'Tipo de comprobación hecha a una instalación.';

CREATE TYPE admin.check_result AS ENUM ('success', 'failure');
COMMENT ON TYPE admin.check_result IS 'Resultado de una comprobación de instalación.';

CREATE TYPE admin.secret_type AS ENUM ('vpn_key', 'minio_credential', 'cert');
COMMENT ON TYPE admin.secret_type IS 'Tipo de secreto de conexión al que apunta la referencia.';

CREATE TYPE iam.user_status AS ENUM ('active', 'inactive', 'locked');
COMMENT ON TYPE iam.user_status IS 'Estado de la cuenta de un usuario.';

CREATE TYPE iam.membership_status AS ENUM ('active', 'suspended');
COMMENT ON TYPE iam.membership_status IS 'Estado de una membresía usuario-organización.';

CREATE TYPE iam.token_purpose AS ENUM ('email_verification', 'password_reset');
COMMENT ON TYPE iam.token_purpose IS 'Propósito de un token de un solo uso.';

CREATE TYPE files.drive_type AS ENUM ('personal', 'team');
COMMENT ON TYPE files.drive_type IS 'Tipo de espacio: personal o de equipo (Team Drive).';

CREATE TYPE files.destination_provider AS ENUM ('s3', 'minio');
COMMENT ON TYPE files.destination_provider IS 'Proveedor de almacenamiento de objetos de un destino.';

CREATE TYPE files.connection_status AS ENUM ('Sin comprobar', 'Comprobando', 'Conectado', 'Sin conexión');
COMMENT ON TYPE files.connection_status IS 'Estados de la conexión de un destino (documento de arquitectura).';

CREATE TYPE files.key_status AS ENUM ('active', 'rotated', 'revoked');
COMMENT ON TYPE files.key_status IS 'Estado de una KEK de tenant.';

CREATE TYPE files.upload_status AS ENUM ('Pendiente', 'Cargando', 'Confirmando', 'Disponible', 'Fallida', 'Limpieza pendiente');
COMMENT ON TYPE files.upload_status IS 'Estados de una carga (SEQ-01A/B/D del documento de arquitectura).';

CREATE TYPE files.reservation_status AS ENUM ('active', 'released', 'expired');
COMMENT ON TYPE files.reservation_status IS 'Estado de una reserva de cuota.';

CREATE TYPE files.permission_level AS ENUM ('read', 'write', 'admin');
COMMENT ON TYPE files.permission_level IS 'Nivel de permiso de una ACL.';

CREATE TYPE billing.subscription_status AS ENUM ('active', 'expired', 'cancelled');
COMMENT ON TYPE billing.subscription_status IS 'Estado de una suscripción.';

CREATE TYPE billing.revision_status AS ENUM ('pending', 'confirmed', 'rejected');
COMMENT ON TYPE billing.revision_status IS 'Estado de una revisión de plan.';

CREATE TYPE billing.operation_type AS ENUM ('charge', 'renewal');
COMMENT ON TYPE billing.operation_type IS 'Tipo de operación de facturación simulada.';

CREATE TYPE audit.actor_type AS ENUM ('user', 'visitor', 'system');
COMMENT ON TYPE audit.actor_type IS 'Quién originó un evento de auditoría.';

CREATE TYPE audit.event_result AS ENUM ('success', 'failure');
COMMENT ON TYPE audit.event_result IS 'Resultado de la operación auditada.';

-- migrate:down
DROP TYPE audit.event_result;
DROP TYPE audit.actor_type;
DROP TYPE billing.operation_type;
DROP TYPE billing.revision_status;
DROP TYPE billing.subscription_status;
DROP TYPE files.permission_level;
DROP TYPE files.reservation_status;
DROP TYPE files.upload_status;
DROP TYPE files.key_status;
DROP TYPE files.connection_status;
DROP TYPE files.destination_provider;
DROP TYPE files.drive_type;
DROP TYPE iam.token_purpose;
DROP TYPE iam.membership_status;
DROP TYPE iam.user_status;
DROP TYPE admin.secret_type;
DROP TYPE admin.check_result;
DROP TYPE admin.check_type;
DROP TYPE admin.installation_status;
DROP TYPE admin.request_status;
DROP TYPE admin.deployment_model;
DROP TYPE admin.organization_status;
