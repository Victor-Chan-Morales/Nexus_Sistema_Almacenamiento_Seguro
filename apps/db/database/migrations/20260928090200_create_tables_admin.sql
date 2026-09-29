-- migrate:up
-- Tablas del dominio admin (PK inline: una tabla sin PK nunca es un estado intermedio válido). FK, UNIQUE, CHECK e índices van en migraciones posteriores.

CREATE TABLE admin.organization (
  organization_id   uuid                       NOT NULL DEFAULT gen_random_uuid(),
  name              varchar(150)               NOT NULL,
  status            admin.organization_status  NOT NULL DEFAULT 'active',
  deployment_model  admin.deployment_model     NOT NULL,
  created_at        timestamptz                NOT NULL DEFAULT now(),
  updated_at        timestamptz,
  CONSTRAINT pk_organization PRIMARY KEY (organization_id)
);
COMMENT ON TABLE admin.organization IS 'Organización cliente (tenant). Ancla del aislamiento multi-tenant: casi todas las demás tablas cuelgan de ella.';
COMMENT ON COLUMN admin.organization.organization_id IS 'Identificador de la organización cliente';
COMMENT ON COLUMN admin.organization.name IS 'Nombre de la organización';
COMMENT ON COLUMN admin.organization.status IS 'active / suspended / cancelled';
COMMENT ON COLUMN admin.organization.deployment_model IS 'cloud / on_premises / hybrid';
COMMENT ON COLUMN admin.organization.created_at IS 'Fecha de alta';
COMMENT ON COLUMN admin.organization.updated_at IS 'Última modificación';

CREATE TABLE admin.installation_request (
  request_id         uuid                    NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid                    NOT NULL,
  requested_model    admin.deployment_model  NOT NULL,
  status             admin.request_status    NOT NULL DEFAULT 'Pendiente',
  requested_by       uuid                    NOT NULL,
  assigned_operator  varchar(150),
  created_at         timestamptz             NOT NULL DEFAULT now(),
  reviewed_at        timestamptz,
  CONSTRAINT pk_installation_request PRIMARY KEY (request_id)
);
COMMENT ON TABLE admin.installation_request IS 'Solicitud de un Tenant Admin para cambiar el modelo de despliegue (nube, servidor propio, híbrido). Nace en estado Pendiente (MK-15).';
COMMENT ON COLUMN admin.installation_request.request_id IS 'Identificador de la solicitud';
COMMENT ON COLUMN admin.installation_request.organization_id IS 'Organización solicitante';
COMMENT ON COLUMN admin.installation_request.requested_model IS 'cloud / on_premises / hybrid (MK-15)';
COMMENT ON COLUMN admin.installation_request.status IS 'Pendiente / Aprobada / Rechazada / Cerrada';
COMMENT ON COLUMN admin.installation_request.requested_by IS 'Tenant Admin que solicita';
COMMENT ON COLUMN admin.installation_request.assigned_operator IS 'Operador autorizado (AC-11)';
COMMENT ON COLUMN admin.installation_request.created_at IS 'Fecha de solicitud';
COMMENT ON COLUMN admin.installation_request.reviewed_at IS 'Fecha de revisión del Super Admin';

CREATE TABLE admin.installation (
  installation_id    uuid                       NOT NULL DEFAULT gen_random_uuid(),
  organization_id    uuid                       NOT NULL,
  request_id         uuid                       NOT NULL,
  deployment_model   admin.deployment_model     NOT NULL,
  status             admin.installation_status  NOT NULL,
  installed_version  varchar(50),
  host_reference     varchar(255),
  operator_name      varchar(150)               NOT NULL,
  created_at         timestamptz                NOT NULL DEFAULT now(),
  updated_at         timestamptz,
  CONSTRAINT pk_installation PRIMARY KEY (installation_id)
);
COMMENT ON TABLE admin.installation IS 'Instalación originada por una solicitud: estado, versión instalada y operador responsable (AC-11).';
COMMENT ON COLUMN admin.installation.installation_id IS 'Identificador de la instalación';
COMMENT ON COLUMN admin.installation.organization_id IS 'Organización dueña';
COMMENT ON COLUMN admin.installation.request_id IS 'Solicitud que la originó';
COMMENT ON COLUMN admin.installation.deployment_model IS 'Modelo efectivo instalado';
COMMENT ON COLUMN admin.installation.status IS 'No solicitada / Pendiente / En proceso / Operativa / Fallida';
COMMENT ON COLUMN admin.installation.installed_version IS 'Versión del paquete Compose';
COMMENT ON COLUMN admin.installation.host_reference IS 'Host registrado del cliente';
COMMENT ON COLUMN admin.installation.operator_name IS 'Persona responsable (AC-11)';
COMMENT ON COLUMN admin.installation.created_at IS 'Fecha de creación';
COMMENT ON COLUMN admin.installation.updated_at IS 'Último cambio de estado';

CREATE TABLE admin.installation_check (
  check_id         uuid                NOT NULL DEFAULT gen_random_uuid(),
  installation_id  uuid                NOT NULL,
  check_type       admin.check_type    NOT NULL,
  result           admin.check_result  NOT NULL,
  checked_at       timestamptz         NOT NULL DEFAULT now(),
  CONSTRAINT pk_installation_check PRIMARY KEY (check_id)
);
COMMENT ON TABLE admin.installation_check IS 'Comprobaciones (conectividad, espacio, Docker, puertos, certificados, prueba de escritura/lectura/borrado) hechas a una instalación.';
COMMENT ON COLUMN admin.installation_check.check_id IS 'Identificador de la comprobación';
COMMENT ON COLUMN admin.installation_check.installation_id IS 'Instalación verificada';
COMMENT ON COLUMN admin.installation_check.check_type IS 'connectivity / space / docker / ports / certs / write_read_delete_test';
COMMENT ON COLUMN admin.installation_check.result IS 'success / failure';
COMMENT ON COLUMN admin.installation_check.checked_at IS 'Momento de la comprobación';

CREATE TABLE admin.connection_secret_ref (
  secret_ref_id       uuid               NOT NULL DEFAULT gen_random_uuid(),
  installation_id     uuid               NOT NULL,
  secret_type         admin.secret_type  NOT NULL,
  external_reference  varchar(500)       NOT NULL,
  created_at          timestamptz        NOT NULL DEFAULT now(),
  CONSTRAINT pk_connection_secret_ref PRIMARY KEY (secret_ref_id)
);
COMMENT ON TABLE admin.connection_secret_ref IS 'Referencias a secretos de conexión de una instalación. Guarda el puntero, nunca el secreto.';
COMMENT ON COLUMN admin.connection_secret_ref.secret_ref_id IS 'Identificador de la referencia';
COMMENT ON COLUMN admin.connection_secret_ref.installation_id IS 'Instalación asociada';
COMMENT ON COLUMN admin.connection_secret_ref.secret_type IS 'vpn_key / minio_credential / cert';
COMMENT ON COLUMN admin.connection_secret_ref.external_reference IS 'Puntero al secreto real, nunca el secreto';
COMMENT ON COLUMN admin.connection_secret_ref.created_at IS 'Fecha de registro';

-- migrate:down
DROP TABLE admin.connection_secret_ref;
DROP TABLE admin.installation_check;
DROP TABLE admin.installation;
DROP TABLE admin.installation_request;
DROP TABLE admin.organization;
