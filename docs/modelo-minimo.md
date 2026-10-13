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
- `FILE` y `FILE_VERSION`: metadatos visibles y ubicación/versionado del objeto; los bytes quedan en SeaweedFS.

## Reglas de persistencia

1. UUID para entidades con UUID en el diccionario; claves foráneas y restricciones únicas deben estar en PostgreSQL, no solo en código.
2. Migraciones versionadas y revisables. No cambiar a mano la base compartida.
3. Identidad, plan y metadatos son SQL; contenido del archivo es object storage.
4. `size_bytes` proviene de `FILE_VERSION`; el uso del dashboard no se ingresa manualmente.
5. En el 30%, se puede guardar solo la primera versión por archivo; mantener una forma compatible con la futura entidad `FILE_VERSION`.
6. No modelar ahora instalaciones, enlaces, equipos, auditoría completa, llaves, reservas concurrentes o política híbrida si el recorrido del 30% no las necesita. No eliminarlas del producto final. MFA/TOTP queda fuera del alcance actual.

## Decisiones operativas aprobadas

- El registro crea el Drive personal `Mi espacio` y la carpeta raíz `Archivos`.
- `Auditor` es un rol formal de solo lectura sobre la auditoría de su organización.
- Una organización tiene como máximo una suscripción activa, mediante índice parcial o restricción equivalente.
- Los nombres de carpeta son únicos dentro del mismo padre sin distinguir mayúsculas/minúsculas; la papelera usa borrado lógico y conserva cuota durante 30 días.
- Los valores iniciales de cuota y archivo están en `docs/decisions/ADR-003-detalles-operativos-aprobados.md`.
