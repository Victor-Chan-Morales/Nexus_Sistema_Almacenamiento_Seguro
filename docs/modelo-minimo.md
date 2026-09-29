# Modelo de datos mínimo para el recorrido

El diccionario completo sigue siendo la referencia para la meta final. No creen de inmediato todas sus tablas. Para el primer flujo, el equipo debe revisar esta selección con responsables de dominio antes de escribir migraciones.

## Entidades del recorrido

- `ORGANIZATION`: tenant del cliente, estado y modelo de despliegue.
- `USER`: correo único, Argon2id `password_hash`, nombre y estado.
- `MEMBERSHIP` + `ROLE`: relación usuario-organización y rol. Mantener `UNIQUE(user_id, organization_id)`.
- `SESSION` o equivalente: sesión revocable; estrategia exacta pendiente del módulo IAM.
- `PLAN` y `SUBSCRIPTION`: catálogo y vigencia por organización; activación de demo simulada.
- `DRIVE`: seleccionar un drive inicial autorizado para la demo; no asumir que la organización puede escribir a cualquier drive.
- `FOLDER`: organización, drive, padre opcional, nombre y estado lógico.
- `FILE` y `FILE_VERSION`: metadatos visibles y ubicación/versionado del objeto; los bytes quedan en MinIO.

## Reglas de persistencia

1. UUID para entidades con UUID en el diccionario; claves foráneas y restricciones únicas deben estar en PostgreSQL, no solo en código.
2. Migraciones versionadas y revisables. No cambiar a mano la base compartida.
3. Identidad, plan y metadatos son SQL; contenido del archivo es object storage.
4. `size_bytes` proviene de `FILE_VERSION`; el uso del dashboard no se ingresa manualmente.
5. En el 30%, se puede guardar solo la primera versión por archivo; mantener una forma compatible con la futura entidad `FILE_VERSION`.
6. No modelar ahora instalaciones, enlaces, equipos, auditoría completa, llaves, reservas concurrentes o política híbrida si el recorrido del 30% no las necesita. No eliminarlas del producto final. MFA/TOTP queda fuera del alcance actual.

## Pendiente de validar

- Si la primera unidad operativa será un drive personal o de equipo.
- Cómo se representa el rol Auditor, que es stakeholder/rol en la propuesta pero no aparece como valor inicial en la tabla `ROLE` del diccionario.
- Implementar una restricción o índice parcial que limite a una suscripción activa por organización.
- La revisión aprobada establece una sola suscripción activa por organización; la migración debe expresarlo con una restricción o índice parcial.
- Restricciones únicas de nombre de carpeta por padre, soft-delete y política de cuotas.
