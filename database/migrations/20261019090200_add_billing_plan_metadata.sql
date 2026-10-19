-- migrate:up
-- Extiende el catálogo canónico con los campos requeridos por CONTRACTS.md v0.4.

ALTER TABLE billing.plan
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN validity_days integer;

UPDATE billing.plan
   SET description = CASE name
         WHEN 'Demo' THEN 'Espacio de trabajo de prueba para una organización pequeña.'
         WHEN 'Team' THEN 'Almacenamiento seguro para equipos pequeños.'
         WHEN 'Business' THEN 'Más capacidad y espacio para organizaciones en crecimiento.'
         WHEN 'Enterprise' THEN 'Capacidad ampliada para organizaciones con mayor volumen.'
         ELSE ''
       END,
       validity_days = CASE WHEN name = 'Demo' THEN NULL ELSE 30 END;

ALTER TABLE billing.plan
  ADD CONSTRAINT ck_plan_validity_days_positive
  CHECK (validity_days IS NULL OR validity_days > 0);

-- migrate:down
ALTER TABLE billing.plan DROP CONSTRAINT ck_plan_validity_days_positive;
ALTER TABLE billing.plan DROP COLUMN validity_days;
ALTER TABLE billing.plan DROP COLUMN description;
