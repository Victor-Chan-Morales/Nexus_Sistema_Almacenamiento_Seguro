# SPEC-222: DRIVE DE EQUIPO, ACCESO DE LECTURA

## 1. Metadatos

| Campo | Valor |
|---|---|
| **Nivel de Rigor** | N2 (autorización) |
| **Responsable Principal** | Por asignar |
| **Aprobador** | Víctor Chán Morales |
| **Módulo Afectado** | `apps/api/src/modules/files/` |
| **Requisitos Vinculados** | RF-006 |
| **Dependencias** | SPEC-220, SPEC-209, SPEC-210 |
| **Prioridad** | P1 |
| **Estimación** | 3 h |
| **Estado** | Aprobada (2026-11-04, Víctor Chán Morales) |

## 2. Objetivo

Los miembros de un equipo ven y descargan el contenido de su Drive. Quien no pertenece, ni siquiera sabe que existe.

## 3. Fuera de Alcance

- Escribir en el Drive (SPEC-224).
- Pantallas (SPEC-223).

## 4. Criterios de Aceptación

```gherkin
Escenario 1: Mis Drives
  Cuando envía GET /drives
  Entonces recibe su Drive personal y los de sus equipos, con myLevel
  Y un tenant_admin recibe todos los de equipo de su organización

Escenario 2: Navegar
  Dado un miembro con nivel read o write
  Cuando envía GET /folders?driveId=<equipo> o GET /folders/:id/items
  Entonces recibe el contenido

Escenario 3: Descargar
  Dado un miembro con nivel read
  Cuando envía GET /files/:id/download de un archivo del Drive
  Entonces recibe los bytes y se registra FILE_DOWNLOAD a su nombre

Escenario 4: No miembro
  Dado alguien que no pertenece al equipo y no es tenant_admin
  Entonces toda ruta sobre ese Drive, carpeta o archivo responde 404

Escenario 5: Otra organización
  Dado un driveId, folderId o fileId de otra organización → 404

Escenario 6: Quitar del equipo
  Cuando se quita a un miembro
  Entonces su siguiente solicitud responde 404

Escenario 7: Papelera y versiones
  Dado un miembro
  Entonces GET /files/trash?driveId=<equipo> y GET /files/:id/versions funcionan

Escenario 8: Compatibilidad
  Dada una solicitud sin driveId
  Entonces se comporta exactamente como antes, sobre el Drive personal

Escenario 9: Enlaces
  Dado un miembro con nivel read
  Entonces no puede crear enlaces (404 si no es miembro, 403 si solo tiene lectura)
```

## 5. Contrato de API

- **Nueva:** `GET /drives` → `{ items: [{ id, name, type: "personal" | "team", teamId, rootFolderId, myLevel }] }`.
- **Parámetro opcional `driveId`:** `GET /folders`, `GET /files/trash`.
- Las demás rutas derivan el Drive del recurso.
- Error nuevo: `403 DRIVE_PERMISSION_DENIED`, solo para quien sí tiene acceso de lectura.

## 6. Datos y Esquema

Sin migración.

## 8. Diseño Técnico

- **`DriveAccessService.findDrive`:** Drive personal → `owner` si es el dueño. Drive de equipo → `write` si `tenant_admin`; si no, el nivel de `team_member`; si no hay fila → `null`, es decir `404`.
- `DriveActor` añade `role`. Se obtiene de `AuthUser`.
- **`downloadFileStream`, `getFolderItems`, `listFolders`, `listFiles`, `listTrash` y versiones** pasan a usar el acceso resuelto.
- `getOrCreateUserDrive` se sigue usando solo cuando no hay `driveId`.
- **Riesgo:** pruebas de aislamiento por cada ruta de lectura (escenarios 4 y 5).

## 9. Plan de Tareas

- [ ] **T1 (50 min)**: Resolver equipo y nivel en `DriveAccessService`.
- [ ] **T2 (20 min)**: `GET /drives`.
- [ ] **T3 (60 min)**: Rutas de lectura con `driveId`.
- [ ] **T4 (50 min)**: Pruebas.

**Archivos permitidos:** `files/drive-access.service.ts` y su spec, `files/files.service.ts`, `files/files.controller.ts`, `files/file-versions.service.ts`, `files/drives.controller.ts` (nuevo), `files/files.module.ts`.

## 10. Estrategia de Pruebas

| Criterio | Tipo | Archivo |
|---|---|---|
| Escenarios 1–9 | Unitaria | `drive-access.service.spec.ts`, `files.service.spec.ts` |
| Escenarios 4, 5 | E2E con Postgres | `apps/api/test/` |

## 11. Impacto en Documentación

- [ ] `CONTRACTS.md` v0.6: matriz RBAC ampliada.

## 12. Preguntas Abiertas

Ninguna.

## 13. Registro de Cambios

| Fecha | Autor | Descripción |
|---|---|---|
| 2026-11-04 | Claude Code (borrador) | Versión inicial. |
| 2026-11-04 | Víctor Chán Morales | Aprobada. Se agregan SPEC-209 y SPEC-210, que sus escenarios y archivos ya requerían. |
