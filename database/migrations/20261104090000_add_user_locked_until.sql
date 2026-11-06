-- migrate:up
-- SPEC-112: bloqueo progresivo por intentos fallidos. `locked_until` guarda hasta cuándo no se aceptan
-- intentos de login. `status = 'locked'` queda para bloqueos administrativos permanentes.
ALTER TABLE iam."user" ADD COLUMN locked_until timestamptz;
COMMENT ON COLUMN iam."user".locked_until IS 'Bloqueo temporal por intentos fallidos';

-- migrate:down
ALTER TABLE iam."user" DROP COLUMN locked_until;
