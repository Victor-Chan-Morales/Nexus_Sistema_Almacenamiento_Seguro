# SPEC-224: DRIVE DE EQUIPO, ACCIONES DE EDICIÓN

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (autorización y cuota) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-006, RF-009 |
| **Dependencias** | SPEC-222 |
| **Prioridad** | P1 |
| **Estimación** | 1.5 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Quien tiene nivel de edición sube, crea carpetas y envía a la papelera en el Drive del equipo. Quien solo tiene lectura recibe un rechazo.

## 3. Fuera de Alcance

- Pantallas (SPEC-223).
- Renombrar y mover (SPEC-211).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Edición
  Dado un miembro con nivel write
  Entonces puede subir, crear carpetas, enviar a la papelera, restaurar y crear enlaces
  Y cada acción se audita a su nombre

Escenario 2: Lectura
  Dado un miembro con nivel read
  Cuando intenta cualquiera de esas acciones
  Entonces responde 403 DRIVE_PERMISSION_DENIED y no cambia nada

Escenario 3: Borrado definitivo
  Dado un miembro con nivel write → purgar responde 403 DRIVE_PERMISSION_DENIED
  Dado un tenant_admin → purgar funciona

Escenario 4: Drive personal sin cambios
  Dado el dueño de un Drive personal
  Entonces sigue pudiendo purgar (ADR-007 §7)

Escenario 5: Cuota compartida
  Dada una subida a un Drive de equipo
  Entonces cuenta en la cuota de la organización con las mismas reglas

Escenario 6: Versiones de equipo
  Cuando dos miembros suben el mismo nombre en la misma carpeta
  Entonces se crea una versión nueva y uploaded_by indica a cada uno

Escenario 7: Carpeta a otro Drive
  Dado un parentFolderId de otro Drive al que no tiene acceso → 404
```

## 5. Contrato de API

Sin rutas nuevas. Las rutas existentes de escritura pueden responder `403 DRIVE_PERMISSION_DENIED`.

## 6. Datos y Esquema

Sin migración.

## 8. Diseño Técnico

```typescript
// DriveAccessService
assertCanWrite(access: DriveAccess): void; // read → 403
assertCanPurge(access: DriveAccess, actor: DriveActor): void; // personal: owner; equipo: solo tenant_admin
```

- Aplicar en `uploadMultipartFile`, `createFolder`, `softDelete`, `softDeleteFolder`, `restoreFile`, `restoreFolder`, `purgeFile`, `purgeFolder`, `FileVersionsService.restoreVersion` y `ShareLinksService.create`.
- `activeUploadsByUser` sigue por usuario.
- **Riesgo:** una ruta de escritura sin verificación. Las pruebas recorren la lista completa con un miembro `read`.

## 9. Plan de Tareas

- [ ] **T1 (20 min)**: `assertCanWrite` y `assertCanPurge`.
- [ ] **T2 (35 min)**: Aplicar a cada operación.
- [ ] **T3 (35 min)**: Pruebas.

**Archivos permitidos:** `files/drive-access.service.ts`, `files/files.service.ts`, `files/file-versions.service.ts`, `files/share-links.service.ts`, sus `*.spec.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–7 | Unitaria | `drive-access.service.spec.ts`, `files.service.spec.ts` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6.
- [ ] `ADR-008` §7: confirmar la regla de borrado definitivo.

## 12. Preguntas Abiertas

Ninguna. Decisión del coordinador (2026-11-04): el borrado definitivo en un Drive de equipo queda solo para el administrador (ADR-003 y ADR-008 §7).

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada, con decisión de §12. |
