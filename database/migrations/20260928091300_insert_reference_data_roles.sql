-- migrate:up
-- Datos de referencia: los dos roles de organización. Van en migración (no en seeds) porque
-- iam.membership.role_id es NOT NULL y el sistema no funciona sin ellos, en cualquier entorno.
-- Super Admin no es un rol: es iam.user.is_super_admin.

INSERT INTO iam.role (name, description) VALUES
  ('tenant_admin', 'Administra su organización: miembros, permisos, políticas y destinos de almacenamiento.'),
  ('colaborador', 'Lee, sube, descarga y comparte archivos según los permisos que se le asignen.')
ON CONFLICT (name) DO NOTHING;

-- migrate:down
DELETE FROM iam.role WHERE name IN ('tenant_admin', 'colaborador');
