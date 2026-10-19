-- migrate:up
-- Datos de referencia: catálogo de planes aprobado en CONTRACTS.md v0.4. Van en migración (no en seeds)
-- porque el alta de cualquier organización contrata el plan Demo y sin él el registro no funciona,
-- en cualquier entorno. El nombre se vuelve único: el alta y GET /plans lo resuelven por nombre.
-- storage_limit_gb usa GB decimales (5 GB = 5 000 000 000 bytes, igual que storageLimitBytes del contrato).

ALTER TABLE billing.plan ADD CONSTRAINT uq_plan_name UNIQUE (name);

INSERT INTO billing.plan (name, storage_limit_gb, user_limit, price_monthly) VALUES
  ('Demo',         5,   5,   0.00),
  ('Team',       100,  10,  19.99),
  ('Business',   500,  30,  59.99),
  ('Enterprise', 2000, 100, 149.99)
ON CONFLICT (name) DO NOTHING;

-- migrate:down
DELETE FROM billing.plan WHERE name IN ('Demo', 'Team', 'Business', 'Enterprise');
ALTER TABLE billing.plan DROP CONSTRAINT uq_plan_name;
