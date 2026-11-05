# SPEC-215: PURGA AUTOMÁTICA A LOS 30 DÍAS

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (borrado irreversible y cuota) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-009, RF-013; ADR-008 §9 |
| **Dependencias** | SPEC-221, SPEC-407 |
| **Prioridad** | P1 |
| **Estimación** | 2.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Lo que está en la papelera cuenta en la cuota hasta borrarse, y una tarea lo borra a los 30 días. Corrige la contradicción actual: tras 30 días deja de contarse, pero los bytes siguen guardados.

## 3. Fuera de Alcance

- Vaciar la papelera manualmente.
- Plazo configurable por plan u organización.
- Avisos previos por correo.

## 4. Criterios de Aceptación

```gherkin
Escenario 1: La papelera cuenta
  Dado un archivo con más de 30 días en la papelera, aún sin purgar
  Entonces sus versiones siguen sumando en el uso

Escenario 2: Purga de archivo
  Dado un archivo con deleted_at de hace más de 30 días
  Cuando se ejecuta la tarea
  Entonces desaparecen sus filas, se reescribe la cuota y se borran sus objetos tras el commit
  Y se registra FILE_PURGE con actor "system"

Escenario 3: Purga de carpeta
  Dada una carpeta raíz de papelera con más de 30 días
  Entonces se purga todo su árbol, incluidos los archivos eliminados con ella
  Y se registra FOLDER_PURGE con actor "system"

Escenario 4: Dentro del plazo
  Dado un elemento con menos de 30 días → no se toca

Escenario 5: Restaurar pasado el plazo
  Dado un archivo con más de 30 días aún no purgado
  Cuando se restaura
  Entonces responde 200, sin verificar la cuota de nuevo porque ya la consumía

Escenario 6: Dos instancias
  Dadas dos ejecuciones simultáneas
  Entonces cada elemento se purga una sola vez, sin errores

Escenario 7: Fallo parcial
  Dado que falla un elemento del lote
  Entonces se registra, los demás continúan y se reintenta en el siguiente ciclo

Escenario 8: Falla el almacén
  Dado que no se puede borrar un objeto
  Entonces los metadatos quedan purgados y el objeto huérfano se registra (criterio de SPEC-204)

Escenario 9: Organización cerrada o suspendida
  Dada una organización que no está activa
  Entonces la tarea no purga nada de ella (ADR-008 §6)
```

## 5. Contrato de API

Sin rutas. `retentionEndsAt` pasa a significar "fecha de borrado". Puede seguir apareciendo en el pasado hasta el siguiente ciclo.

El `422 STORAGE_QUOTA_EXCEEDED` por retención vencida en `POST /files/:id/restore` y `POST /folders/:id/restore` **se elimina**.

## 6. Datos y Esquema

Sin migración. El índice de `deleted_at`, si no existe, se agrega solo si la prueba manual con datos lo exige.

## 7. Interfaz de Usuario

`trash-view.tsx`: texto "Se eliminará el <fecha>". Quitar el mensaje de cuota al restaurar por retención si deja de aplicar.

## 8. Diseño Técnico

- **Cuota:** quitar `AND (... deleted_at > now() - interval ...)` en `files.service.ts` (consultas de las líneas ~586 y ~612) para contar todo lo que aún exista. Quitar las ramas de verificación por retención (líneas ~1236 y ~1423).
- **Tarea:** `TrashRetentionService` con el patrón de `AuditOutboxService`: `onModuleInit` + `setInterval(...).unref()`, sin solapar lotes y esperando en `onModuleDestroy`. No se agrega `@nestjs/schedule`. Intervalo: `TRASH_PURGE_INTERVAL_MS`, por defecto 1 hora.
- **Selección:** lotes de 50, con `FOR UPDATE SKIP LOCKED` dentro de la transacción de cada elemento, solo en organizaciones `active`. Carpetas raíz de papelera primero, luego archivos.
- **Reutilización:** exponer en `FilesService` `purgeExpiredFile(fileId, organizationId)` y `purgeExpiredFolder(folderId, organizationId)`, que internamente usan `applyPurge`, `removeFileRows` y `deleteOrphanObjects`. No duplicar el orden de las FK.
- **Auditoría:** `actorType: SYSTEM`, sin `actorId` (SPEC-407).
- **Riesgo:** un error de fecha borra datos reales. Mitigación: la consulta usa `deleted_at <= now() - interval '30 days'` y `is_deleted = true`, cubierta por los escenarios 2 y 4.

## 9. Plan de Tareas

- [ ] **T1 (30 min)**: Corregir el cálculo de cuota y las ramas de restauración, con sus pruebas.
- [ ] **T2 (60 min)**: `TrashRetentionService`.
- [ ] **T3 (15 min)**: Texto en la papelera.
- [ ] **T4 (45 min)**: Pruebas y prueba manual cambiando `deleted_at` en una base de desarrollo.

**Archivos permitidos:** `files/trash-retention.service.ts` y su spec (nuevos), `files/files.service.ts`, `files/files.module.ts`, `files/files.trash.spec.ts`, `files/files.folder-trash.spec.ts`, `components/trash-view.tsx`, `.env.example`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1, 5 | Unitaria | `files.trash.spec.ts` |
| Escenarios 2–4, 7–9 | Unitaria | `trash-retention.service.spec.ts` |
| Escenario 6 | E2E con Postgres | `apps/api/test/` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6 (ya enmendado por SPEC-004: confirmar).
- [ ] `apps/api/src/modules/files/README.md`.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. |
| 2026-11-04 | Claude Code (revisión) | Se agrega SPEC-221 como dependencia, porque edita `files.service.ts`. Aprobado por el coordinador (2026-11-04). |
