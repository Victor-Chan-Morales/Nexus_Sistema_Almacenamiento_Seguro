-- migrate:up
-- Mantiene updated_at automáticamente (solo cuando la fila realmente cambia).

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.set_updated_at() IS 'Trigger BEFORE UPDATE: fija updated_at = now() cuando la fila cambia.';

CREATE TRIGGER trg_organization_set_updated_at
  BEFORE UPDATE ON admin.organization
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_installation_set_updated_at
  BEFORE UPDATE ON admin.installation
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_user_set_updated_at
  BEFORE UPDATE ON iam."user"
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_folder_set_updated_at
  BEFORE UPDATE ON files.folder
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_file_set_updated_at
  BEFORE UPDATE ON files.file
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_destination_set_updated_at
  BEFORE UPDATE ON files.destination
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_upload_set_updated_at
  BEFORE UPDATE ON files.upload
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tenant_quota_set_updated_at
  BEFORE UPDATE ON files.tenant_quota
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION public.set_updated_at();

-- migrate:down
DROP TRIGGER trg_tenant_quota_set_updated_at ON files.tenant_quota;
DROP TRIGGER trg_upload_set_updated_at ON files.upload;
DROP TRIGGER trg_destination_set_updated_at ON files.destination;
DROP TRIGGER trg_file_set_updated_at ON files.file;
DROP TRIGGER trg_folder_set_updated_at ON files.folder;
DROP TRIGGER trg_user_set_updated_at ON iam."user";
DROP TRIGGER trg_installation_set_updated_at ON admin.installation;
DROP TRIGGER trg_organization_set_updated_at ON admin.organization;
DROP FUNCTION public.set_updated_at();
