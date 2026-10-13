-- migrate:up
-- Tablas del dominio files (PK inline: una tabla sin PK nunca es un estado intermedio válido). FK, UNIQUE, CHECK e índices van en migraciones posteriores.

CREATE TABLE files.team (
  team_id          uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid          NOT NULL,
  name             varchar(150)  NOT NULL,
  created_by       uuid          NOT NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_team PRIMARY KEY (team_id)
);
COMMENT ON TABLE files.team IS 'Equipo de una organización; puede poseer un Team Drive.';
COMMENT ON COLUMN files.team.team_id IS 'Identificador del equipo';
COMMENT ON COLUMN files.team.organization_id IS 'Organización dueña';
COMMENT ON COLUMN files.team.name IS 'Nombre del equipo';
COMMENT ON COLUMN files.team.created_by IS 'Quién lo creó';
COMMENT ON COLUMN files.team.created_at IS 'Fecha de creación';

CREATE TABLE files.team_member (
  team_id    uuid         NOT NULL,
  user_id    uuid         NOT NULL,
  joined_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_team_member PRIMARY KEY (team_id, user_id)
);
COMMENT ON TABLE files.team_member IS 'Miembros de un equipo (tabla intermedia usuario-equipo, muchos a muchos).';
COMMENT ON COLUMN files.team_member.team_id IS 'Equipo';
COMMENT ON COLUMN files.team_member.user_id IS 'Miembro';
COMMENT ON COLUMN files.team_member.joined_at IS 'Fecha de ingreso';

CREATE TABLE files.drive (
  drive_id         uuid              NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid              NOT NULL,
  type             files.drive_type  NOT NULL,
  owner_user_id    uuid,
  team_id          uuid,
  name             varchar(150)      NOT NULL,
  created_at       timestamptz       NOT NULL DEFAULT now(),
  CONSTRAINT pk_drive PRIMARY KEY (drive_id)
);
COMMENT ON TABLE files.drive IS 'Espacio de almacenamiento: personal (de un usuario) o de equipo (Team Drive).';
COMMENT ON COLUMN files.drive.drive_id IS 'Identificador del espacio';
COMMENT ON COLUMN files.drive.organization_id IS 'Organización dueña';
COMMENT ON COLUMN files.drive.type IS 'personal / team';
COMMENT ON COLUMN files.drive.owner_user_id IS 'Solo si type = personal';
COMMENT ON COLUMN files.drive.team_id IS 'Solo si type = team';
COMMENT ON COLUMN files.drive.name IS 'Nombre del espacio';
COMMENT ON COLUMN files.drive.created_at IS 'Fecha de creación';

CREATE TABLE files.folder (
  folder_id         uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id   uuid          NOT NULL,
  drive_id          uuid          NOT NULL,
  parent_folder_id  uuid,
  destination_id    uuid,
  name              varchar(255)  NOT NULL,
  created_by        uuid          NOT NULL,
  is_deleted        boolean       NOT NULL DEFAULT false,
  deleted_at        timestamptz,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  CONSTRAINT pk_folder PRIMARY KEY (folder_id)
);
COMMENT ON TABLE files.folder IS 'Carpeta de un drive: jerarquía autorreferenciada, borrado lógico (papelera) y destino de almacenamiento propio opcional.';
COMMENT ON COLUMN files.folder.folder_id IS 'Identificador de carpeta';
COMMENT ON COLUMN files.folder.organization_id IS 'Denormalizado — valida tenant sin cruzar por Drive';
COMMENT ON COLUMN files.folder.drive_id IS 'Espacio al que pertenece';
COMMENT ON COLUMN files.folder.parent_folder_id IS 'NULL = raíz del drive';
COMMENT ON COLUMN files.folder.destination_id IS 'Política efectiva (AC-03)';
COMMENT ON COLUMN files.folder.name IS 'Nombre de la carpeta';
COMMENT ON COLUMN files.folder.created_by IS 'Quién la creó';
COMMENT ON COLUMN files.folder.is_deleted IS 'Papelera';
COMMENT ON COLUMN files.folder.deleted_at IS 'Momento del borrado lógico';
COMMENT ON COLUMN files.folder.created_at IS 'Fecha de creación';
COMMENT ON COLUMN files.folder.updated_at IS 'Última modificación';

CREATE TABLE files.file (
  file_id             uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL,
  folder_id           uuid          NOT NULL,
  name                varchar(255)  NOT NULL,
  mime_type           varchar(100),
  current_version_id  uuid,
  is_deleted          boolean       NOT NULL DEFAULT false,
  deleted_at          timestamptz,
  created_by          uuid          NOT NULL,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz,
  CONSTRAINT pk_file PRIMARY KEY (file_id)
);
COMMENT ON TABLE files.file IS 'Archivo lógico dentro de una carpeta; su contenido vive en sus versiones. Borrado lógico (papelera).';
COMMENT ON COLUMN files.file.file_id IS 'Identificador de archivo';
COMMENT ON COLUMN files.file.organization_id IS 'Denormalizado';
COMMENT ON COLUMN files.file.folder_id IS 'Carpeta contenedora';
COMMENT ON COLUMN files.file.name IS 'Nombre visible';
COMMENT ON COLUMN files.file.mime_type IS 'Tipo de contenido';
COMMENT ON COLUMN files.file.current_version_id IS 'Versión vigente';
COMMENT ON COLUMN files.file.is_deleted IS 'Papelera';
COMMENT ON COLUMN files.file.deleted_at IS 'Momento del borrado lógico';
COMMENT ON COLUMN files.file.created_by IS 'Quién lo subió originalmente';
COMMENT ON COLUMN files.file.created_at IS 'Fecha de creación';
COMMENT ON COLUMN files.file.updated_at IS 'Última modificación';

CREATE TABLE files.file_version (
  version_id      uuid          NOT NULL DEFAULT gen_random_uuid(),
  file_id         uuid          NOT NULL,
  version_number  integer       NOT NULL,
  destination_id  uuid          NOT NULL,
  object_key      varchar(500)  NOT NULL,
  size_bytes      bigint        NOT NULL,
  checksum        varchar(128)  NOT NULL,
  encrypted_dek   varchar(500)  NOT NULL,
  kek_id          uuid          NOT NULL,
  format_version  smallint      NOT NULL,
  uploaded_by     uuid          NOT NULL,
  uploaded_at     timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_file_version PRIMARY KEY (version_id)
);
COMMENT ON TABLE files.file_version IS 'Versión de un archivo: objeto cifrado en un destino, con su DEK protegida por una KEK del tenant.';
COMMENT ON COLUMN files.file_version.version_id IS 'Identificador de la versión';
COMMENT ON COLUMN files.file_version.file_id IS 'Archivo al que pertenece';
COMMENT ON COLUMN files.file_version.version_number IS 'Número secuencial';
COMMENT ON COLUMN files.file_version.destination_id IS 'Destino donde "nació" esta versión (AC-03)';
COMMENT ON COLUMN files.file_version.object_key IS 'Clave del objeto en S3/MinIO';
COMMENT ON COLUMN files.file_version.size_bytes IS 'Tamaño real recibido';
COMMENT ON COLUMN files.file_version.checksum IS 'Hash de integridad (ej. Blake2b)';
COMMENT ON COLUMN files.file_version.encrypted_dek IS 'DEK cifrada con la KEK, contexto tenant+versión';
COMMENT ON COLUMN files.file_version.kek_id IS 'KEK usada';
COMMENT ON COLUMN files.file_version.format_version IS 'Versión del formato criptográfico (DA-05)';
COMMENT ON COLUMN files.file_version.uploaded_by IS 'Quién subió esta versión';
COMMENT ON COLUMN files.file_version.uploaded_at IS 'Fecha de subida (COMMIT)';

CREATE TABLE files.destination (
  destination_id                uuid                        NOT NULL DEFAULT gen_random_uuid(),
  organization_id               uuid                        NOT NULL,
  provider_type                 files.destination_provider  NOT NULL,
  connection_status             files.connection_status     NOT NULL DEFAULT 'Sin comprobar',
  is_enabled                    boolean                     NOT NULL DEFAULT true,
  is_default                    boolean                     NOT NULL DEFAULT false,
  bucket_or_prefix              varchar(255)                NOT NULL,
  connection_details_encrypted  text                        NOT NULL,
  created_at                    timestamptz                 NOT NULL DEFAULT now(),
  updated_at                    timestamptz,
  CONSTRAINT pk_destination PRIMARY KEY (destination_id)
);
COMMENT ON TABLE files.destination IS 'Destino de almacenamiento habilitado para una organización (S3 o MinIO) y su estado de conexión.';
COMMENT ON COLUMN files.destination.destination_id IS 'Identificador del destino';
COMMENT ON COLUMN files.destination.organization_id IS 'Organización dueña';
COMMENT ON COLUMN files.destination.provider_type IS 's3 / minio';
COMMENT ON COLUMN files.destination.connection_status IS 'Sin comprobar / Comprobando / Conectado / Sin conexión';
COMMENT ON COLUMN files.destination.is_enabled IS 'Habilitado para operar';
COMMENT ON COLUMN files.destination.is_default IS 'Destino por defecto';
COMMENT ON COLUMN files.destination.bucket_or_prefix IS 'Bucket/prefijo restringido al tenant';
COMMENT ON COLUMN files.destination.connection_details_encrypted IS 'Endpoint y credencial, cifrados';
COMMENT ON COLUMN files.destination.created_at IS 'Fecha de alta';
COMMENT ON COLUMN files.destination.updated_at IS 'Último cambio';

CREATE TABLE files.tenant_encryption_key (
  key_id              uuid              NOT NULL DEFAULT gen_random_uuid(),
  organization_id     uuid              NOT NULL,
  external_reference  varchar(500)      NOT NULL,
  status              files.key_status  NOT NULL DEFAULT 'active',
  created_at          timestamptz       NOT NULL DEFAULT now(),
  rotated_at          timestamptz,
  CONSTRAINT pk_tenant_encryption_key PRIMARY KEY (key_id)
);
COMMENT ON TABLE files.tenant_encryption_key IS 'KEK (llave de cifrado de llaves) de un tenant. Solo guarda una referencia externa: la llave nunca vive en PostgreSQL (DA-05).';
COMMENT ON COLUMN files.tenant_encryption_key.key_id IS 'Identificador de la KEK';
COMMENT ON COLUMN files.tenant_encryption_key.organization_id IS 'Tenant dueño';
COMMENT ON COLUMN files.tenant_encryption_key.external_reference IS 'Puntero al secreto real fuera de PostgreSQL — la llave nunca se guarda aquí (DA-05)';
COMMENT ON COLUMN files.tenant_encryption_key.status IS 'active / rotated / revoked';
COMMENT ON COLUMN files.tenant_encryption_key.created_at IS 'Fecha de generación';
COMMENT ON COLUMN files.tenant_encryption_key.rotated_at IS 'Fecha de rotación';

CREATE TABLE files.upload (
  upload_id            uuid                 NOT NULL DEFAULT gen_random_uuid(),
  organization_id      uuid                 NOT NULL,
  folder_id            uuid                 NOT NULL,
  idempotency_key      varchar(255)         NOT NULL,
  declared_name        varchar(255)         NOT NULL,
  declared_size_bytes  bigint               NOT NULL,
  received_size_bytes  bigint,
  status               files.upload_status  NOT NULL DEFAULT 'Pendiente',
  reservation_id       uuid                 NOT NULL,
  destination_id       uuid                 NOT NULL,
  object_key           varchar(500),
  created_by           uuid                 NOT NULL,
  created_at           timestamptz          NOT NULL DEFAULT now(),
  updated_at           timestamptz,
  CONSTRAINT pk_upload PRIMARY KEY (upload_id)
);
COMMENT ON TABLE files.upload IS 'Carga de un archivo con su máquina de estados (SEQ-01A/B/D); enlaza una reserva de cuota y un destino.';
COMMENT ON COLUMN files.upload.upload_id IS 'Identificador de la carga';
COMMENT ON COLUMN files.upload.organization_id IS 'Denormalizado — mismo bloqueo de cuota';
COMMENT ON COLUMN files.upload.folder_id IS 'Carpeta destino';
COMMENT ON COLUMN files.upload.idempotency_key IS 'Evita duplicar versión si se pierde la respuesta';
COMMENT ON COLUMN files.upload.declared_name IS 'Nombre declarado por el cliente';
COMMENT ON COLUMN files.upload.declared_size_bytes IS 'Tamaño declarado (no confiable solo)';
COMMENT ON COLUMN files.upload.received_size_bytes IS 'Tamaño real medido';
COMMENT ON COLUMN files.upload.status IS 'Pendiente / Cargando / Confirmando / Disponible / Fallida / Limpieza pendiente';
COMMENT ON COLUMN files.upload.reservation_id IS 'Reserva de cuota asociada';
COMMENT ON COLUMN files.upload.destination_id IS 'Destino elegido (preliminar)';
COMMENT ON COLUMN files.upload.object_key IS 'Clave del objeto una vez iniciada la escritura';
COMMENT ON COLUMN files.upload.created_by IS 'Usuario que sube';
COMMENT ON COLUMN files.upload.created_at IS 'Inicio de la carga';
COMMENT ON COLUMN files.upload.updated_at IS 'Último cambio de estado';

CREATE TABLE files.reservation (
  reservation_id   uuid                      NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid                      NOT NULL,
  size_bytes       bigint                    NOT NULL,
  status           files.reservation_status  NOT NULL DEFAULT 'active',
  expires_at       timestamptz               NOT NULL,
  created_at       timestamptz               NOT NULL DEFAULT now(),
  CONSTRAINT pk_reservation PRIMARY KEY (reservation_id)
);
COMMENT ON TABLE files.reservation IS 'Reserva temporal de cuota mientras dura una carga; se convierte en uso al confirmar.';
COMMENT ON COLUMN files.reservation.reservation_id IS 'Identificador de la reserva';
COMMENT ON COLUMN files.reservation.organization_id IS 'Tenant cuya cuota se reserva';
COMMENT ON COLUMN files.reservation.size_bytes IS 'Espacio reservado';
COMMENT ON COLUMN files.reservation.status IS 'active / released / expired';
COMMENT ON COLUMN files.reservation.expires_at IS 'Vencimiento — se renueva mientras la carga siga activa';
COMMENT ON COLUMN files.reservation.created_at IS 'Fecha de creación, misma transacción que la carga';

CREATE TABLE files.tenant_quota (
  organization_id            uuid         NOT NULL,
  confirmed_usage_bytes      bigint       NOT NULL DEFAULT 0,
  active_reservations_bytes  bigint       NOT NULL DEFAULT 0,
  updated_at                 timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT pk_tenant_quota PRIMARY KEY (organization_id)
);
COMMENT ON TABLE files.tenant_quota IS 'Contadores de cuota por organización (una fila por tenant). Se bloquea con SELECT ... FOR UPDATE al validar cargas (SEQ-01A).';
COMMENT ON COLUMN files.tenant_quota.organization_id IS 'Una fila por organización';
COMMENT ON COLUMN files.tenant_quota.confirmed_usage_bytes IS 'Suma de versiones confirmadas, sin duplicar';
COMMENT ON COLUMN files.tenant_quota.active_reservations_bytes IS 'Suma de reservas activas';
COMMENT ON COLUMN files.tenant_quota.updated_at IS 'Última actualización';

CREATE TABLE files.share_link (
  link_id          uuid          NOT NULL DEFAULT gen_random_uuid(),
  organization_id  uuid          NOT NULL,
  version_id       uuid          NOT NULL,
  token_hash       varchar(255)  NOT NULL,
  password_hash    varchar(255),
  expires_at       timestamptz   NOT NULL,
  revoked_at       timestamptz,
  created_by       uuid          NOT NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT pk_share_link PRIMARY KEY (link_id)
);
COMMENT ON TABLE files.share_link IS 'Enlace público a una versión fija de un archivo (AC-07). Solo guarda el hash del token.';
COMMENT ON COLUMN files.share_link.link_id IS 'Identificador del enlace';
COMMENT ON COLUMN files.share_link.organization_id IS 'Resuelto desde el enlace, nunca del visitante';
COMMENT ON COLUMN files.share_link.version_id IS 'Versión fija que entrega el enlace (AC-07)';
COMMENT ON COLUMN files.share_link.token_hash IS 'Hash de un token aleatorio';
COMMENT ON COLUMN files.share_link.password_hash IS 'Contraseña opcional';
COMMENT ON COLUMN files.share_link.expires_at IS 'Vencimiento — siempre obligatorio';
COMMENT ON COLUMN files.share_link.revoked_at IS 'Revocación inmediata';
COMMENT ON COLUMN files.share_link.created_by IS 'Quién generó el enlace';
COMMENT ON COLUMN files.share_link.created_at IS 'Fecha de creación';

CREATE TABLE files.resource_access (
  access_id         uuid                    NOT NULL DEFAULT gen_random_uuid(),
  file_id           uuid,
  folder_id         uuid,
  team_id           uuid,
  user_id           uuid,
  permission_level  files.permission_level  NOT NULL,
  granted_by        uuid                    NOT NULL,
  granted_at        timestamptz             NOT NULL DEFAULT now(),
  CONSTRAINT pk_resource_access PRIMARY KEY (access_id)
);
COMMENT ON TABLE files.resource_access IS 'ACL: permiso de un usuario o equipo sobre un archivo o carpeta. Columnas nullable + CHECK en vez de referencias polimórficas.';
COMMENT ON COLUMN files.resource_access.access_id IS 'Identificador del permiso';
COMMENT ON COLUMN files.resource_access.file_id IS 'Recurso, si es un archivo';
COMMENT ON COLUMN files.resource_access.folder_id IS 'Recurso, si es una carpeta';
COMMENT ON COLUMN files.resource_access.team_id IS 'Beneficiario, si es un equipo';
COMMENT ON COLUMN files.resource_access.user_id IS 'Beneficiario, si es un usuario';
COMMENT ON COLUMN files.resource_access.permission_level IS 'read / write / admin';
COMMENT ON COLUMN files.resource_access.granted_by IS 'Quién otorgó el permiso';
COMMENT ON COLUMN files.resource_access.granted_at IS 'Fecha de otorgamiento';

-- migrate:down
DROP TABLE files.resource_access;
DROP TABLE files.share_link;
DROP TABLE files.tenant_quota;
DROP TABLE files.reservation;
DROP TABLE files.upload;
DROP TABLE files.tenant_encryption_key;
DROP TABLE files.destination;
DROP TABLE files.file_version;
DROP TABLE files.file;
DROP TABLE files.folder;
DROP TABLE files.drive;
DROP TABLE files.team_member;
DROP TABLE files.team;
