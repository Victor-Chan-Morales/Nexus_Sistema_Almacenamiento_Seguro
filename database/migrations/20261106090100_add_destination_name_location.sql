-- migrate:up
-- SPEC-802: nombre y ubicación (nube o servidor local) de cada destino. Los destinos existentes quedan en nube con el nombre por defecto.
CREATE TYPE files.destination_location AS ENUM ('cloud', 'on_premises');
COMMENT ON TYPE files.destination_location IS 'Ubicación física de un destino de almacenamiento.';

ALTER TABLE files.destination
  ADD COLUMN location files.destination_location NOT NULL DEFAULT 'cloud',
  ADD COLUMN name varchar(150) NOT NULL DEFAULT 'Almacenamiento Nexus';
COMMENT ON COLUMN files.destination.location IS 'cloud / on_premises';
COMMENT ON COLUMN files.destination.name IS 'Nombre visible del destino';

-- migrate:down
ALTER TABLE files.destination
  DROP COLUMN name,
  DROP COLUMN location;
DROP TYPE files.destination_location;
