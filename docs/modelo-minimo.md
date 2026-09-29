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
6. No modelar ahora instalaciones, enlaces, equipos, auditoría completa, llaves, reservas concurrentes o política híbrida si el recorrido del 30% no las necesita. No eliminarlas del producto final.

## Revisión del diagrama de clases compartido

El diagrama actualizado agrega servicios de aplicación y cubre más capacidades del producto final. No reemplaza el modelo mínimo de este documento ni autoriza a crear todas sus entidades en el siguiente avance. La comparación técnica y las correcciones pendientes están en `docs/revision-diagrama-clases.md`.

Para cualquier implementación del recorrido, deben permanecer explícitas estas relaciones y datos:

- Usuario–Membresía–Organización y Usuario–Sesión, con claves foráneas y multiplicidad; la membresía conserva UNIQUE(user_id, organization_id).
- Organización con sus drives, carpetas, archivos, destinos, suscripciones e instalaciones; cada consulta valida tenant en API.
- Carpeta con destino efectivo opcional/heredado; FileVersion con destino inmutable de la versión y referencia de llave correspondiente.
- FILE_VERSION incluye tamaño real, número secuencial, object_key, checksum, uploaded_by y uploaded_at, además del material cifrado/referencia de KEK cuando se implemente cifrado.
- PLAN incluye los límites definidos por el diccionario. La conversión entre storage_limit_gb y storageLimitBytes debe ser determinista y documentada.
- AUDIT_EVENT conserva organización, actor, recurso, resultado, correlation_id, occurred_at, prev_hash y record_hash en el alcance de auditoría.

Estos puntos no amplían el avance por sí solos; indican condiciones de consistencia para las entidades que sí entren al corte.

## Pendiente de validar

- Si la primera unidad operativa será un drive personal o de equipo.
- Cómo se representa el rol Auditor, que es stakeholder/rol en la propuesta pero no aparece como valor inicial en la tabla `ROLE` del diccionario.
- Índice parcial/otra regla que limite a una suscripción activa por organización.
- Restricciones únicas de nombre de carpeta por padre, soft-delete y política de cuotas.
