-- migrate:up
-- Restricciones UNIQUE. Van ANTES de las FK: las FK compuestas "tenant-safe" y la de file.current_version_id
-- referencian estas claves. Las de la forma (organization_id, <pk>) no aportan unicidad nueva (el PK ya es único):
-- existen solo como destino de esas FK.

-- Correo único (MER).
ALTER TABLE iam."user"
  ADD CONSTRAINT uq_user_email UNIQUE (email);

-- Nombre de rol único (MER).
ALTER TABLE iam.role
  ADD CONSTRAINT uq_role_name UNIQUE (name);

-- Una membresía por par usuario-organización (MER).
ALTER TABLE iam.membership
  ADD CONSTRAINT uq_membership_user_organization UNIQUE (user_id, organization_id);

-- Búsqueda por token.
ALTER TABLE iam.one_time_token
  ADD CONSTRAINT uq_one_time_token_token_hash UNIQUE (token_hash);

-- Búsqueda por refresh token.
ALTER TABLE iam.session
  ADD CONSTRAINT uq_session_refresh_token_hash UNIQUE (refresh_token_hash);

-- Cardinalidad 0..1 solicitud-instalación (MER).
ALTER TABLE admin.installation
  ADD CONSTRAINT uq_installation_request UNIQUE (request_id);

-- Idempotencia de cargas (MER, SEQ-01D).
ALTER TABLE files.upload
  ADD CONSTRAINT uq_upload_organization_idempotency UNIQUE (organization_id, idempotency_key);

-- Relación 1:1 carga-reserva (MER).
ALTER TABLE files.upload
  ADD CONSTRAINT uq_upload_reservation UNIQUE (reservation_id);

-- Hash de token único (MER).
ALTER TABLE files.share_link
  ADD CONSTRAINT uq_share_link_token_hash UNIQUE (token_hash);

-- Número de versión único por archivo.
ALTER TABLE files.file_version
  ADD CONSTRAINT uq_file_version_number UNIQUE (file_id, version_number);

-- Destino de la FK compuesta file.current_version_id.
ALTER TABLE files.file_version
  ADD CONSTRAINT uq_file_version_file_version UNIQUE (file_id, version_id);

-- Un objeto por clave y destino (SEQ-01B: cada intento usa clave nueva).
ALTER TABLE files.file_version
  ADD CONSTRAINT uq_file_version_object UNIQUE (destination_id, object_key);

-- Destino de FK compuestas tenant-safe.
ALTER TABLE files.team
  ADD CONSTRAINT uq_team_organization_team UNIQUE (organization_id, team_id);

-- Destino de FK compuestas tenant-safe.
ALTER TABLE files.drive
  ADD CONSTRAINT uq_drive_organization_drive UNIQUE (organization_id, drive_id);

-- Destino de FK compuestas tenant-safe.
ALTER TABLE files.folder
  ADD CONSTRAINT uq_folder_organization_folder UNIQUE (organization_id, folder_id);

-- Destino de FK compuestas tenant-safe.
ALTER TABLE files.destination
  ADD CONSTRAINT uq_destination_organization_destination UNIQUE (organization_id, destination_id);

-- Destino de FK compuestas tenant-safe.
ALTER TABLE files.reservation
  ADD CONSTRAINT uq_reservation_organization_reservation UNIQUE (organization_id, reservation_id);

-- Verificación de la cadena de hashes por organización.
ALTER TABLE audit.audit_event
  ADD CONSTRAINT uq_audit_event_organization_record_hash UNIQUE (organization_id, record_hash);

-- Cardinalidad 0..1 evento-checkpoint (MER).
ALTER TABLE audit.audit_chain_checkpoint
  ADD CONSTRAINT uq_audit_chain_checkpoint_last_event UNIQUE (last_event_id);

-- migrate:down
ALTER TABLE audit.audit_chain_checkpoint DROP CONSTRAINT uq_audit_chain_checkpoint_last_event;
ALTER TABLE audit.audit_event DROP CONSTRAINT uq_audit_event_organization_record_hash;
ALTER TABLE files.reservation DROP CONSTRAINT uq_reservation_organization_reservation;
ALTER TABLE files.destination DROP CONSTRAINT uq_destination_organization_destination;
ALTER TABLE files.folder DROP CONSTRAINT uq_folder_organization_folder;
ALTER TABLE files.drive DROP CONSTRAINT uq_drive_organization_drive;
ALTER TABLE files.team DROP CONSTRAINT uq_team_organization_team;
ALTER TABLE files.file_version DROP CONSTRAINT uq_file_version_object;
ALTER TABLE files.file_version DROP CONSTRAINT uq_file_version_file_version;
ALTER TABLE files.file_version DROP CONSTRAINT uq_file_version_number;
ALTER TABLE files.share_link DROP CONSTRAINT uq_share_link_token_hash;
ALTER TABLE files.upload DROP CONSTRAINT uq_upload_reservation;
ALTER TABLE files.upload DROP CONSTRAINT uq_upload_organization_idempotency;
ALTER TABLE admin.installation DROP CONSTRAINT uq_installation_request;
ALTER TABLE iam.session DROP CONSTRAINT uq_session_refresh_token_hash;
ALTER TABLE iam.one_time_token DROP CONSTRAINT uq_one_time_token_token_hash;
ALTER TABLE iam.membership DROP CONSTRAINT uq_membership_user_organization;
ALTER TABLE iam.role DROP CONSTRAINT uq_role_name;
ALTER TABLE iam."user" DROP CONSTRAINT uq_user_email;
