# Evidencia de SPEC-404

- [Cadena íntegra en Auditoría](01-cadena-integra.png).
- [Inconsistencia y evento afectado en Auditoría](02-evento-alterado.png).

La prueba de navegador usó PostgreSQL con las migraciones aplicadas en una base separada. El endpoint respondió `401` sin JWT y `403 FORBIDDEN_ROLE` a un colaborador. La verificación del administrador devolvió `200` antes y después de modificar la acción de un evento de prueba. La segunda respuesta devolvió `valid: false`, `HASH_MISMATCH` y el ID del evento alterado.

En la base local existente se verificaron nueve cadenas sin alterarlas. Las nueve resultaron íntegras.
