-- migrate:up
-- Llaves foráneas. Todo ON UPDATE RESTRICT (las PK son UUID inmutables).
-- ON DELETE: RESTRICT por defecto (datos de negocio, historial y auditoría no se borran en cascada);
-- CASCADE solo en filas dependientes sin valor propio (comprobaciones, referencias a secretos, membresías,
-- tokens, sesiones, miembros de equipo, la fila de cuota, enlaces y ACL).
-- Las FK compuestas (organization_id, x_id) impiden que una fila apunte a datos de OTRO tenant.

-- ── admin ──
ALTER TABLE admin.installation_request
  ADD CONSTRAINT fk_installation_request_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE admin.installation_request
  ADD CONSTRAINT fk_installation_request_requested_by
  FOREIGN KEY (requested_by)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE admin.installation
  ADD CONSTRAINT fk_installation_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE admin.installation
  ADD CONSTRAINT fk_installation_request
  FOREIGN KEY (request_id)
  REFERENCES admin.installation_request (request_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- La comprobación no tiene sentido sin su instalación.
ALTER TABLE admin.installation_check
  ADD CONSTRAINT fk_installation_check_installation
  FOREIGN KEY (installation_id)
  REFERENCES admin.installation (installation_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- Las referencias mueren con la instalación.
ALTER TABLE admin.connection_secret_ref
  ADD CONSTRAINT fk_connection_secret_ref_installation
  FOREIGN KEY (installation_id)
  REFERENCES admin.installation (installation_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- ── iam ──
-- La membresía es una asociación: desaparece con el usuario.
ALTER TABLE iam.membership
  ADD CONSTRAINT fk_membership_user
  FOREIGN KEY (user_id)
  REFERENCES iam."user" (user_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE iam.membership
  ADD CONSTRAINT fk_membership_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE iam.membership
  ADD CONSTRAINT fk_membership_role
  FOREIGN KEY (role_id)
  REFERENCES iam.role (role_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Artefacto del usuario.
ALTER TABLE iam.one_time_token
  ADD CONSTRAINT fk_one_time_token_user
  FOREIGN KEY (user_id)
  REFERENCES iam."user" (user_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- Artefacto del usuario.
ALTER TABLE iam.session
  ADD CONSTRAINT fk_session_user
  FOREIGN KEY (user_id)
  REFERENCES iam."user" (user_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- ── files ──
ALTER TABLE files.team
  ADD CONSTRAINT fk_team_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.team
  ADD CONSTRAINT fk_team_created_by
  FOREIGN KEY (created_by)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Tabla intermedia: sin equipo no hay membresía.
ALTER TABLE files.team_member
  ADD CONSTRAINT fk_team_member_team
  FOREIGN KEY (team_id)
  REFERENCES files.team (team_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- Tabla intermedia: sin usuario no hay membresía.
ALTER TABLE files.team_member
  ADD CONSTRAINT fk_team_member_user
  FOREIGN KEY (user_id)
  REFERENCES iam."user" (user_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE files.drive
  ADD CONSTRAINT fk_drive_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.drive
  ADD CONSTRAINT fk_drive_owner_user
  FOREIGN KEY (owner_user_id)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FK compuesta tenant-safe.
ALTER TABLE files.drive
  ADD CONSTRAINT fk_drive_team
  FOREIGN KEY (organization_id, team_id)
  REFERENCES files.team (organization_id, team_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.folder
  ADD CONSTRAINT fk_folder_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FK compuesta tenant-safe.
ALTER TABLE files.folder
  ADD CONSTRAINT fk_folder_drive
  FOREIGN KEY (organization_id, drive_id)
  REFERENCES files.drive (organization_id, drive_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FK compuesta tenant-safe (jerarquía).
ALTER TABLE files.folder
  ADD CONSTRAINT fk_folder_parent
  FOREIGN KEY (organization_id, parent_folder_id)
  REFERENCES files.folder (organization_id, folder_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FK compuesta tenant-safe (AC-03).
ALTER TABLE files.folder
  ADD CONSTRAINT fk_folder_destination
  FOREIGN KEY (organization_id, destination_id)
  REFERENCES files.destination (organization_id, destination_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.folder
  ADD CONSTRAINT fk_folder_created_by
  FOREIGN KEY (created_by)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.file
  ADD CONSTRAINT fk_file_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FK compuesta tenant-safe.
ALTER TABLE files.file
  ADD CONSTRAINT fk_file_folder
  FOREIGN KEY (organization_id, folder_id)
  REFERENCES files.folder (organization_id, folder_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FK compuesta: la versión vigente debe pertenecer al mismo archivo. RESTRICT (no SET NULL): file_id es a la vez la PK de esta tabla, y un SET NULL de la FK intentaría poner NULL también en file_id, violando su NOT NULL. Para reemplazar la versión vigente hay que hacer primero UPDATE file SET current_version_id = ... antes de poder borrar la fila vieja de file_version.
ALTER TABLE files.file
  ADD CONSTRAINT fk_file_current_version
  FOREIGN KEY (file_id, current_version_id)
  REFERENCES files.file_version (file_id, version_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.file
  ADD CONSTRAINT fk_file_created_by
  FOREIGN KEY (created_by)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.file_version
  ADD CONSTRAINT fk_file_version_file
  FOREIGN KEY (file_id)
  REFERENCES files.file (file_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.file_version
  ADD CONSTRAINT fk_file_version_destination
  FOREIGN KEY (destination_id)
  REFERENCES files.destination (destination_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.file_version
  ADD CONSTRAINT fk_file_version_kek
  FOREIGN KEY (kek_id)
  REFERENCES files.tenant_encryption_key (key_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.file_version
  ADD CONSTRAINT fk_file_version_uploaded_by
  FOREIGN KEY (uploaded_by)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.destination
  ADD CONSTRAINT fk_destination_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.tenant_encryption_key
  ADD CONSTRAINT fk_tenant_encryption_key_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.upload
  ADD CONSTRAINT fk_upload_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FK compuesta tenant-safe.
ALTER TABLE files.upload
  ADD CONSTRAINT fk_upload_folder
  FOREIGN KEY (organization_id, folder_id)
  REFERENCES files.folder (organization_id, folder_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FK compuesta tenant-safe.
ALTER TABLE files.upload
  ADD CONSTRAINT fk_upload_reservation
  FOREIGN KEY (organization_id, reservation_id)
  REFERENCES files.reservation (organization_id, reservation_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- FK compuesta tenant-safe.
ALTER TABLE files.upload
  ADD CONSTRAINT fk_upload_destination
  FOREIGN KEY (organization_id, destination_id)
  REFERENCES files.destination (organization_id, destination_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.upload
  ADD CONSTRAINT fk_upload_created_by
  FOREIGN KEY (created_by)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE files.reservation
  ADD CONSTRAINT fk_reservation_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Extensión 1:1 de la organización.
ALTER TABLE files.tenant_quota
  ADD CONSTRAINT fk_tenant_quota_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE files.share_link
  ADD CONSTRAINT fk_share_link_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- El enlace no tiene sentido sin la versión que entrega.
ALTER TABLE files.share_link
  ADD CONSTRAINT fk_share_link_version
  FOREIGN KEY (version_id)
  REFERENCES files.file_version (version_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE files.share_link
  ADD CONSTRAINT fk_share_link_created_by
  FOREIGN KEY (created_by)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- La ACL muere con el recurso.
ALTER TABLE files.resource_access
  ADD CONSTRAINT fk_resource_access_file
  FOREIGN KEY (file_id)
  REFERENCES files.file (file_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- La ACL muere con el recurso.
ALTER TABLE files.resource_access
  ADD CONSTRAINT fk_resource_access_folder
  FOREIGN KEY (folder_id)
  REFERENCES files.folder (folder_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- La ACL muere con el beneficiario.
ALTER TABLE files.resource_access
  ADD CONSTRAINT fk_resource_access_team
  FOREIGN KEY (team_id)
  REFERENCES files.team (team_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

-- La ACL muere con el beneficiario.
ALTER TABLE files.resource_access
  ADD CONSTRAINT fk_resource_access_user
  FOREIGN KEY (user_id)
  REFERENCES iam."user" (user_id)
  ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE files.resource_access
  ADD CONSTRAINT fk_resource_access_granted_by
  FOREIGN KEY (granted_by)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── billing ──
ALTER TABLE billing.subscription
  ADD CONSTRAINT fk_subscription_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE billing.subscription
  ADD CONSTRAINT fk_subscription_plan
  FOREIGN KEY (plan_id)
  REFERENCES billing.plan (plan_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE billing.plan_revision
  ADD CONSTRAINT fk_plan_revision_subscription
  FOREIGN KEY (subscription_id)
  REFERENCES billing.subscription (subscription_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE billing.billing_operation
  ADD CONSTRAINT fk_billing_operation_subscription
  FOREIGN KEY (subscription_id)
  REFERENCES billing.subscription (subscription_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ── audit ──
ALTER TABLE audit.audit_event
  ADD CONSTRAINT fk_audit_event_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE audit.audit_event
  ADD CONSTRAINT fk_audit_event_actor
  FOREIGN KEY (actor_id)
  REFERENCES iam."user" (user_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE audit.audit_chain_checkpoint
  ADD CONSTRAINT fk_audit_chain_checkpoint_organization
  FOREIGN KEY (organization_id)
  REFERENCES admin.organization (organization_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE audit.audit_chain_checkpoint
  ADD CONSTRAINT fk_audit_chain_checkpoint_last_event
  FOREIGN KEY (last_event_id)
  REFERENCES audit.audit_event (event_id)
  ON DELETE RESTRICT ON UPDATE RESTRICT;

-- migrate:down
ALTER TABLE audit.audit_chain_checkpoint DROP CONSTRAINT fk_audit_chain_checkpoint_last_event;
ALTER TABLE audit.audit_chain_checkpoint DROP CONSTRAINT fk_audit_chain_checkpoint_organization;
ALTER TABLE audit.audit_event DROP CONSTRAINT fk_audit_event_actor;
ALTER TABLE audit.audit_event DROP CONSTRAINT fk_audit_event_organization;
ALTER TABLE billing.billing_operation DROP CONSTRAINT fk_billing_operation_subscription;
ALTER TABLE billing.plan_revision DROP CONSTRAINT fk_plan_revision_subscription;
ALTER TABLE billing.subscription DROP CONSTRAINT fk_subscription_plan;
ALTER TABLE billing.subscription DROP CONSTRAINT fk_subscription_organization;
ALTER TABLE files.resource_access DROP CONSTRAINT fk_resource_access_granted_by;
ALTER TABLE files.resource_access DROP CONSTRAINT fk_resource_access_user;
ALTER TABLE files.resource_access DROP CONSTRAINT fk_resource_access_team;
ALTER TABLE files.resource_access DROP CONSTRAINT fk_resource_access_folder;
ALTER TABLE files.resource_access DROP CONSTRAINT fk_resource_access_file;
ALTER TABLE files.share_link DROP CONSTRAINT fk_share_link_created_by;
ALTER TABLE files.share_link DROP CONSTRAINT fk_share_link_version;
ALTER TABLE files.share_link DROP CONSTRAINT fk_share_link_organization;
ALTER TABLE files.tenant_quota DROP CONSTRAINT fk_tenant_quota_organization;
ALTER TABLE files.reservation DROP CONSTRAINT fk_reservation_organization;
ALTER TABLE files.upload DROP CONSTRAINT fk_upload_created_by;
ALTER TABLE files.upload DROP CONSTRAINT fk_upload_destination;
ALTER TABLE files.upload DROP CONSTRAINT fk_upload_reservation;
ALTER TABLE files.upload DROP CONSTRAINT fk_upload_folder;
ALTER TABLE files.upload DROP CONSTRAINT fk_upload_organization;
ALTER TABLE files.tenant_encryption_key DROP CONSTRAINT fk_tenant_encryption_key_organization;
ALTER TABLE files.destination DROP CONSTRAINT fk_destination_organization;
ALTER TABLE files.file_version DROP CONSTRAINT fk_file_version_uploaded_by;
ALTER TABLE files.file_version DROP CONSTRAINT fk_file_version_kek;
ALTER TABLE files.file_version DROP CONSTRAINT fk_file_version_destination;
ALTER TABLE files.file_version DROP CONSTRAINT fk_file_version_file;
ALTER TABLE files.file DROP CONSTRAINT fk_file_created_by;
ALTER TABLE files.file DROP CONSTRAINT fk_file_current_version;
ALTER TABLE files.file DROP CONSTRAINT fk_file_folder;
ALTER TABLE files.file DROP CONSTRAINT fk_file_organization;
ALTER TABLE files.folder DROP CONSTRAINT fk_folder_created_by;
ALTER TABLE files.folder DROP CONSTRAINT fk_folder_destination;
ALTER TABLE files.folder DROP CONSTRAINT fk_folder_parent;
ALTER TABLE files.folder DROP CONSTRAINT fk_folder_drive;
ALTER TABLE files.folder DROP CONSTRAINT fk_folder_organization;
ALTER TABLE files.drive DROP CONSTRAINT fk_drive_team;
ALTER TABLE files.drive DROP CONSTRAINT fk_drive_owner_user;
ALTER TABLE files.drive DROP CONSTRAINT fk_drive_organization;
ALTER TABLE files.team_member DROP CONSTRAINT fk_team_member_user;
ALTER TABLE files.team_member DROP CONSTRAINT fk_team_member_team;
ALTER TABLE files.team DROP CONSTRAINT fk_team_created_by;
ALTER TABLE files.team DROP CONSTRAINT fk_team_organization;
ALTER TABLE iam.session DROP CONSTRAINT fk_session_user;
ALTER TABLE iam.one_time_token DROP CONSTRAINT fk_one_time_token_user;
ALTER TABLE iam.membership DROP CONSTRAINT fk_membership_role;
ALTER TABLE iam.membership DROP CONSTRAINT fk_membership_organization;
ALTER TABLE iam.membership DROP CONSTRAINT fk_membership_user;
ALTER TABLE admin.connection_secret_ref DROP CONSTRAINT fk_connection_secret_ref_installation;
ALTER TABLE admin.installation_check DROP CONSTRAINT fk_installation_check_installation;
ALTER TABLE admin.installation DROP CONSTRAINT fk_installation_request;
ALTER TABLE admin.installation DROP CONSTRAINT fk_installation_organization;
ALTER TABLE admin.installation_request DROP CONSTRAINT fk_installation_request_requested_by;
ALTER TABLE admin.installation_request DROP CONSTRAINT fk_installation_request_organization;
