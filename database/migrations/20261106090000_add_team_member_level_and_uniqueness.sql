-- migrate:up
-- SPEC-220: equipos y sus miembros. Cada miembro tiene nivel de lectura o edición; el nombre del equipo es único
-- por organización sin distinguir mayúsculas; un equipo tiene como máximo un Drive.
ALTER TABLE files.team_member
  ADD COLUMN permission_level files.permission_level NOT NULL DEFAULT 'read';
COMMENT ON COLUMN files.team_member.permission_level IS 'read / write. El valor admin del tipo no se usa en equipos.';
ALTER TABLE files.team_member
  ADD CONSTRAINT ck_team_member_level CHECK (permission_level IN ('read', 'write'));
CREATE UNIQUE INDEX uq_team_name_per_organization ON files.team (organization_id, lower(name));
CREATE UNIQUE INDEX uq_drive_one_per_team ON files.drive (team_id) WHERE team_id IS NOT NULL;

-- migrate:down
-- No borra datos. Si algún miembro tiene nivel write, la columna no se puede quitar sin perderlo:
-- la migración falla y dbmate la revierte. Para descartarlo, decidirlo a mano.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM files.team_member WHERE permission_level <> 'read') THEN
    RAISE EXCEPTION 'Hay miembros de equipo con nivel write; quitar permission_level los descartaría';
  END IF;
END $$;
DROP INDEX files.uq_drive_one_per_team;
DROP INDEX files.uq_team_name_per_organization;
ALTER TABLE files.team_member DROP CONSTRAINT ck_team_member_level;
ALTER TABLE files.team_member DROP COLUMN permission_level;
