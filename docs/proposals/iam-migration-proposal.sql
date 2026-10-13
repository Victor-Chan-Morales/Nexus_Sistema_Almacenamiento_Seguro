-- PROPUESTA DE MIGRACIÓN (módulo IAM) — NO ejecutar directamente ni versionar en este PR.
-- Según CONTRIBUTING: los módulos envían la propuesta al integrador y un solo PR cambia
-- la migración compartida. Toca el esquema `iam` (tabla existente "user" + 2 tablas nuevas).
-- Ajustar nombres/tipos si ya difieren en docs/modelo-minimo.md o en la migración vigente.

ALTER TABLE iam."user"
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Red de seguridad: el correo es único sin distinguir mayúsculas (la API ya lo guarda normalizado).
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_email_lower ON iam."user" (lower(email));

CREATE TABLE IF NOT EXISTS iam.email_verification_token (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES iam."user"(id) ON DELETE CASCADE,
  token_hash  varchar(64) NOT NULL UNIQUE,   -- solo SHA-256; el token en claro solo viaja por correo
  expires_at  timestamptz NOT NULL,          -- 15 minutos desde la emisión
  used_at     timestamptz,                   -- un solo uso
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_email_verification_token_user ON iam.email_verification_token (user_id);

CREATE TABLE IF NOT EXISTS iam.refresh_token (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES iam."user"(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL,
  token_hash      varchar(64) NOT NULL UNIQUE, -- solo SHA-256; el valor en claro vive en la cookie HttpOnly
  expires_at      timestamptz NOT NULL,        -- 7 días
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_refresh_token_user ON iam.refresh_token (user_id);
