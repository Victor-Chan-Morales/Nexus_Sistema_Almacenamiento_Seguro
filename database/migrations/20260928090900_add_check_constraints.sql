-- migrate:up
-- Restricciones CHECK: invariantes del MER (drive, resource_access, actor de auditoría, MFA, tamaño al confirmar carga...)
-- más higiene básica (no negativos, orden de fechas, textos no vacíos, coherencia de borrado lógico).

ALTER TABLE admin.organization
  ADD CONSTRAINT ck_organization_name_not_blank CHECK (char_length(btrim(name)) > 0);

ALTER TABLE admin.installation_request
  ADD CONSTRAINT ck_installation_request_reviewed_after_created CHECK (reviewed_at IS NULL OR reviewed_at >= created_at);

ALTER TABLE admin.installation
  ADD CONSTRAINT ck_installation_operator_name_not_blank CHECK (char_length(btrim(operator_name)) > 0);

ALTER TABLE iam."user"
  ADD CONSTRAINT ck_user_email_lowercase CHECK (email = lower(email));

ALTER TABLE iam."user"
  ADD CONSTRAINT ck_user_email_format CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$');

ALTER TABLE iam."user"
  ADD CONSTRAINT ck_user_full_name_not_blank CHECK (char_length(btrim(full_name)) > 0);

ALTER TABLE iam."user"
  ADD CONSTRAINT ck_user_mfa_requires_secret CHECK (NOT mfa_enabled OR mfa_secret_encrypted IS NOT NULL);

ALTER TABLE iam."user"
  ADD CONSTRAINT ck_user_failed_login_attempts_non_negative CHECK (failed_login_attempts >= 0);

ALTER TABLE iam.one_time_token
  ADD CONSTRAINT ck_one_time_token_expires_after_created CHECK (expires_at > created_at);

ALTER TABLE iam.one_time_token
  ADD CONSTRAINT ck_one_time_token_used_after_created CHECK (used_at IS NULL OR used_at >= created_at);

ALTER TABLE iam.session
  ADD CONSTRAINT ck_session_expires_after_created CHECK (expires_at > created_at);

ALTER TABLE iam.session
  ADD CONSTRAINT ck_session_revoked_after_created CHECK (revoked_at IS NULL OR revoked_at >= created_at);

ALTER TABLE files.team
  ADD CONSTRAINT ck_team_name_not_blank CHECK (char_length(btrim(name)) > 0);

ALTER TABLE files.drive
  ADD CONSTRAINT ck_drive_type_owner CHECK ((type = 'personal' AND owner_user_id IS NOT NULL AND team_id IS NULL) OR (type = 'team' AND team_id IS NOT NULL AND owner_user_id IS NULL));

ALTER TABLE files.drive
  ADD CONSTRAINT ck_drive_name_not_blank CHECK (char_length(btrim(name)) > 0);

ALTER TABLE files.folder
  ADD CONSTRAINT ck_folder_not_own_parent CHECK (parent_folder_id IS NULL OR parent_folder_id <> folder_id);

ALTER TABLE files.folder
  ADD CONSTRAINT ck_folder_soft_delete_consistent CHECK (is_deleted = (deleted_at IS NOT NULL));

ALTER TABLE files.folder
  ADD CONSTRAINT ck_folder_name_not_blank CHECK (char_length(btrim(name)) > 0);

ALTER TABLE files.file
  ADD CONSTRAINT ck_file_soft_delete_consistent CHECK (is_deleted = (deleted_at IS NOT NULL));

ALTER TABLE files.file
  ADD CONSTRAINT ck_file_name_not_blank CHECK (char_length(btrim(name)) > 0);

ALTER TABLE files.file_version
  ADD CONSTRAINT ck_file_version_number_positive CHECK (version_number >= 1);

ALTER TABLE files.file_version
  ADD CONSTRAINT ck_file_version_size_non_negative CHECK (size_bytes >= 0);

ALTER TABLE files.file_version
  ADD CONSTRAINT ck_file_version_format_positive CHECK (format_version >= 1);

ALTER TABLE files.file_version
  ADD CONSTRAINT ck_file_version_checksum_not_blank CHECK (char_length(btrim(checksum)) > 0);

ALTER TABLE files.destination
  ADD CONSTRAINT ck_destination_bucket_not_blank CHECK (char_length(btrim(bucket_or_prefix)) > 0);

ALTER TABLE files.tenant_encryption_key
  ADD CONSTRAINT ck_tenant_encryption_key_rotated_after_created CHECK (rotated_at IS NULL OR rotated_at >= created_at);

ALTER TABLE files.upload
  ADD CONSTRAINT ck_upload_declared_name_not_blank CHECK (char_length(btrim(declared_name)) > 0);

ALTER TABLE files.upload
  ADD CONSTRAINT ck_upload_idempotency_key_not_blank CHECK (char_length(btrim(idempotency_key)) > 0);

ALTER TABLE files.upload
  ADD CONSTRAINT ck_upload_declared_size_non_negative CHECK (declared_size_bytes >= 0);

ALTER TABLE files.upload
  ADD CONSTRAINT ck_upload_received_size_non_negative CHECK (received_size_bytes IS NULL OR received_size_bytes >= 0);

ALTER TABLE files.upload
  ADD CONSTRAINT ck_upload_available_size_matches CHECK (status <> 'Disponible' OR (received_size_bytes IS NOT NULL AND received_size_bytes = declared_size_bytes));

ALTER TABLE files.reservation
  ADD CONSTRAINT ck_reservation_size_positive CHECK (size_bytes > 0);

ALTER TABLE files.reservation
  ADD CONSTRAINT ck_reservation_expires_after_created CHECK (expires_at > created_at);

ALTER TABLE files.tenant_quota
  ADD CONSTRAINT ck_tenant_quota_usage_non_negative CHECK (confirmed_usage_bytes >= 0);

ALTER TABLE files.tenant_quota
  ADD CONSTRAINT ck_tenant_quota_reserved_non_negative CHECK (active_reservations_bytes >= 0);

ALTER TABLE files.share_link
  ADD CONSTRAINT ck_share_link_token_hash_not_blank CHECK (char_length(btrim(token_hash)) > 0);

ALTER TABLE files.share_link
  ADD CONSTRAINT ck_share_link_expires_after_created CHECK (expires_at > created_at);

ALTER TABLE files.share_link
  ADD CONSTRAINT ck_share_link_revoked_after_created CHECK (revoked_at IS NULL OR revoked_at >= created_at);

ALTER TABLE files.resource_access
  ADD CONSTRAINT ck_resource_access_one_resource CHECK (num_nonnulls(file_id, folder_id) = 1);

ALTER TABLE files.resource_access
  ADD CONSTRAINT ck_resource_access_one_grantee CHECK (num_nonnulls(team_id, user_id) = 1);

ALTER TABLE billing.plan
  ADD CONSTRAINT ck_plan_name_not_blank CHECK (char_length(btrim(name)) > 0);

ALTER TABLE billing.plan
  ADD CONSTRAINT ck_plan_storage_limit_positive CHECK (storage_limit_gb > 0);

ALTER TABLE billing.plan
  ADD CONSTRAINT ck_plan_user_limit_positive CHECK (user_limit > 0);

ALTER TABLE billing.plan
  ADD CONSTRAINT ck_plan_price_non_negative CHECK (price_monthly >= 0);

ALTER TABLE billing.subscription
  ADD CONSTRAINT ck_subscription_period CHECK (end_date IS NULL OR end_date >= start_date);

ALTER TABLE billing.plan_revision
  ADD CONSTRAINT ck_plan_revision_limit_positive CHECK (new_storage_limit_gb > 0);

ALTER TABLE billing.plan_revision
  ADD CONSTRAINT ck_plan_revision_confirmed_at CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL));

ALTER TABLE billing.billing_operation
  ADD CONSTRAINT ck_billing_operation_amount_non_negative CHECK (amount IS NULL OR amount >= 0);

ALTER TABLE audit.audit_event
  ADD CONSTRAINT ck_audit_event_actor CHECK ((actor_type = 'user') = (actor_id IS NOT NULL));

ALTER TABLE audit.audit_event
  ADD CONSTRAINT ck_audit_event_action_type_not_blank CHECK (char_length(btrim(action_type)) > 0);

ALTER TABLE audit.audit_event
  ADD CONSTRAINT ck_audit_event_record_hash_not_blank CHECK (char_length(btrim(record_hash)) > 0);

ALTER TABLE audit.audit_chain_checkpoint
  ADD CONSTRAINT ck_audit_chain_checkpoint_chain_hash_not_blank CHECK (char_length(btrim(chain_hash)) > 0);

ALTER TABLE audit.audit_chain_checkpoint
  ADD CONSTRAINT ck_audit_chain_checkpoint_signature_not_blank CHECK (char_length(btrim(signature)) > 0);

-- migrate:down
ALTER TABLE audit.audit_chain_checkpoint DROP CONSTRAINT ck_audit_chain_checkpoint_signature_not_blank;
ALTER TABLE audit.audit_chain_checkpoint DROP CONSTRAINT ck_audit_chain_checkpoint_chain_hash_not_blank;
ALTER TABLE audit.audit_event DROP CONSTRAINT ck_audit_event_record_hash_not_blank;
ALTER TABLE audit.audit_event DROP CONSTRAINT ck_audit_event_action_type_not_blank;
ALTER TABLE audit.audit_event DROP CONSTRAINT ck_audit_event_actor;
ALTER TABLE billing.billing_operation DROP CONSTRAINT ck_billing_operation_amount_non_negative;
ALTER TABLE billing.plan_revision DROP CONSTRAINT ck_plan_revision_confirmed_at;
ALTER TABLE billing.plan_revision DROP CONSTRAINT ck_plan_revision_limit_positive;
ALTER TABLE billing.subscription DROP CONSTRAINT ck_subscription_period;
ALTER TABLE billing.plan DROP CONSTRAINT ck_plan_price_non_negative;
ALTER TABLE billing.plan DROP CONSTRAINT ck_plan_user_limit_positive;
ALTER TABLE billing.plan DROP CONSTRAINT ck_plan_storage_limit_positive;
ALTER TABLE billing.plan DROP CONSTRAINT ck_plan_name_not_blank;
ALTER TABLE files.resource_access DROP CONSTRAINT ck_resource_access_one_grantee;
ALTER TABLE files.resource_access DROP CONSTRAINT ck_resource_access_one_resource;
ALTER TABLE files.share_link DROP CONSTRAINT ck_share_link_revoked_after_created;
ALTER TABLE files.share_link DROP CONSTRAINT ck_share_link_expires_after_created;
ALTER TABLE files.share_link DROP CONSTRAINT ck_share_link_token_hash_not_blank;
ALTER TABLE files.tenant_quota DROP CONSTRAINT ck_tenant_quota_reserved_non_negative;
ALTER TABLE files.tenant_quota DROP CONSTRAINT ck_tenant_quota_usage_non_negative;
ALTER TABLE files.reservation DROP CONSTRAINT ck_reservation_expires_after_created;
ALTER TABLE files.reservation DROP CONSTRAINT ck_reservation_size_positive;
ALTER TABLE files.upload DROP CONSTRAINT ck_upload_available_size_matches;
ALTER TABLE files.upload DROP CONSTRAINT ck_upload_received_size_non_negative;
ALTER TABLE files.upload DROP CONSTRAINT ck_upload_declared_size_non_negative;
ALTER TABLE files.upload DROP CONSTRAINT ck_upload_idempotency_key_not_blank;
ALTER TABLE files.upload DROP CONSTRAINT ck_upload_declared_name_not_blank;
ALTER TABLE files.tenant_encryption_key DROP CONSTRAINT ck_tenant_encryption_key_rotated_after_created;
ALTER TABLE files.destination DROP CONSTRAINT ck_destination_bucket_not_blank;
ALTER TABLE files.file_version DROP CONSTRAINT ck_file_version_checksum_not_blank;
ALTER TABLE files.file_version DROP CONSTRAINT ck_file_version_format_positive;
ALTER TABLE files.file_version DROP CONSTRAINT ck_file_version_size_non_negative;
ALTER TABLE files.file_version DROP CONSTRAINT ck_file_version_number_positive;
ALTER TABLE files.file DROP CONSTRAINT ck_file_name_not_blank;
ALTER TABLE files.file DROP CONSTRAINT ck_file_soft_delete_consistent;
ALTER TABLE files.folder DROP CONSTRAINT ck_folder_name_not_blank;
ALTER TABLE files.folder DROP CONSTRAINT ck_folder_soft_delete_consistent;
ALTER TABLE files.folder DROP CONSTRAINT ck_folder_not_own_parent;
ALTER TABLE files.drive DROP CONSTRAINT ck_drive_name_not_blank;
ALTER TABLE files.drive DROP CONSTRAINT ck_drive_type_owner;
ALTER TABLE files.team DROP CONSTRAINT ck_team_name_not_blank;
ALTER TABLE iam.session DROP CONSTRAINT ck_session_revoked_after_created;
ALTER TABLE iam.session DROP CONSTRAINT ck_session_expires_after_created;
ALTER TABLE iam.one_time_token DROP CONSTRAINT ck_one_time_token_used_after_created;
ALTER TABLE iam.one_time_token DROP CONSTRAINT ck_one_time_token_expires_after_created;
ALTER TABLE iam."user" DROP CONSTRAINT ck_user_failed_login_attempts_non_negative;
ALTER TABLE iam."user" DROP CONSTRAINT ck_user_mfa_requires_secret;
ALTER TABLE iam."user" DROP CONSTRAINT ck_user_full_name_not_blank;
ALTER TABLE iam."user" DROP CONSTRAINT ck_user_email_format;
ALTER TABLE iam."user" DROP CONSTRAINT ck_user_email_lowercase;
ALTER TABLE admin.installation DROP CONSTRAINT ck_installation_operator_name_not_blank;
ALTER TABLE admin.installation_request DROP CONSTRAINT ck_installation_request_reviewed_after_created;
ALTER TABLE admin.organization DROP CONSTRAINT ck_organization_name_not_blank;
