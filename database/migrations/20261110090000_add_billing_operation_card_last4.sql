-- migrate:up
ALTER TABLE billing.billing_operation ADD COLUMN card_last4 char(4);
COMMENT ON COLUMN billing.billing_operation.card_last4 IS 'Últimos 4 dígitos de la tarjeta de prueba aprobada. Nunca el número completo ni el CVV (SPEC-305).';
-- migrate:down
ALTER TABLE billing.billing_operation DROP COLUMN card_last4;
